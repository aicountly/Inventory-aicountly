<?php

namespace App\Services;

/**
 * The "Fix what's safe" action behind the mismatch banner.
 *
 * Every difference the reconciliation names has a cause, and only some of those causes are a
 * machine's to act on. What is safe here has one thing in common: it is DELIVERY. Inventory
 * already holds the right answer and Books has not been told it yet, so re-telling changes no
 * figure on either side and is idempotent however many times it runs.
 *
 * What is deliberately NOT here, and why:
 *
 *  - `manual_journal` — someone deliberately journalled the stock ledger. That is a decision, not
 *    an error, and reversing it is not a button's call.
 *  - `missing_source` — Books holds a posting with no Inventory document behind it. Inventory does
 *    not know what that document should have been; inventing one would be worse than the gap.
 *  - `valuation_method_variance` — the corrupted-valuation class, including the company carrying a
 *    negative 43.6 crore. Nothing automatic goes near a cost layer.
 *  - `unacknowledged_valuation_revisions` — tempting, and wrong. The acknowledgement means "Books
 *    has applied this to COGS", and BOOKS writes it (InventoryEventHandler posts to
 *    /v1/valuation/revisions/ack). Inventory acknowledging its own revisions would mark an
 *    unapplied revision as applied and HIDE a real difference. Re-delivering the events is the
 *    honest fix, and that is what draining the outbox below does — Books acks them on receipt.
 *  - `failed_posting` — a retry here is blocked on the idempotency-key rollback path, where a
 *    strict-mode timeout rolls back the tracker row holding the key and a retry double-issues
 *    stock. Until that is re-verified, retrying failed postings from a button is not safe.
 *
 * A dry run reports exactly the same plan without performing it.
 */
class ReconciliationHealService
{
    /** Buckets this service will act on, and nothing else. */
    public const SAFE_BUCKETS = ['opening_difference', 'pending_posting'];

    /** Named so the UI can say what it is leaving alone, rather than implying it fixed everything. */
    public const NEVER_TOUCHED = [
        'manual_journal'                      => 'A person deliberately journalled the stock ledger; reversing that is not automatic.',
        'missing_source'                      => 'Books holds a posting with no Inventory document behind it — only a person can say what it should have been.',
        'valuation_method_variance'           => 'Cost layers are never rewritten automatically.',
        'unacknowledged_valuation_revisions'  => 'Books acknowledges these when it applies them; Inventory doing so would hide an unapplied revision. Re-delivery below is the real fix.',
        'failed_posting'                      => 'Retrying a failed posting is blocked until the idempotency-key rollback path is re-verified — a retry could double-issue stock.',
    ];

    /** Below this, a bucket is not worth acting on. Matches ReconciliationService::ROUNDING_TOLERANCE. */
    private const TOLERANCE = 1.0;

    public function __construct(
        protected ?ReconciliationService $reconciliation = null,
        protected ?OpeningValueSyncService $openingSync = null,
        protected ?OutboxService $outbox = null,
        protected ?AuditService $audit = null,
    ) {
        $this->reconciliation ??= new ReconciliationService();
        $this->openingSync ??= new OpeningValueSyncService();
        $this->outbox ??= new OutboxService();
        $this->audit ??= new AuditService();
    }

    /**
     * @return array{
     *   dry_run: bool, as_of: string, difference: ?float,
     *   actions: list<array{bucket:string, action:string, amount:float, detail:string, performed:bool, result:?string}>,
     *   skipped: list<array{bucket:string, amount:float, reason:string}>
     * }
     */
    public function heal(int $cmpId, int $fyId, int $boId, bool $dryRun, ?string $actor = null): array
    {
        $asOf = date('Y-m-d');
        // Computed fresh rather than read off the last stored run: a heal acting on yesterday's
        // picture would report work it is not doing. The actions are self-checking anyway.
        $result = $this->reconciliation->compute($cmpId, $fyId, $boId, $asOf);
        $buckets = $result['breakdown']['buckets'] ?? [];

        $actions = [];
        $skipped = [];

        $openingAmount = round((float) ($buckets['opening_difference']['amount'] ?? 0), 4);
        if (abs($openingAmount) >= self::TOLERANCE) {
            $action = [
                'bucket'    => 'opening_difference',
                'action'    => 'push_opening_to_books',
                'amount'    => $openingAmount,
                'detail'    => 'Tell Books the opening stock value Inventory holds. Books applies it only where '
                    . 'it may — a figure a person entered is left alone unless this company is on "Inventory Real Data".',
                'performed' => false,
                'result'    => null,
            ];
            if (!$dryRun) {
                try {
                    $this->openingSync->syncIfChanged($cmpId, $fyId, $boId);
                    $action['performed'] = true;
                    $action['result'] = 'queued';
                } catch (\Throwable $e) {
                    $action['result'] = 'failed: ' . $e->getMessage();
                }
            }
            $actions[] = $action;
        }

        $pendingAmount = round((float) ($buckets['pending_posting']['amount'] ?? 0), 4);
        $undelivered = $this->undeliveredCount($cmpId);
        if ($undelivered > 0 || abs($pendingAmount) >= self::TOLERANCE) {
            $action = [
                'bucket'    => 'pending_posting',
                'action'    => 'deliver_outbox',
                'amount'    => $pendingAmount,
                'detail'    => $undelivered . ' event(s) waiting to reach Books. Delivery is idempotent — Books '
                    . 'recognises one it has already seen by its event id and ignores it.',
                'performed' => false,
                'result'    => null,
            ];
            if (!$dryRun) {
                try {
                    $sent = $this->outbox->dispatch(300, null, $cmpId);
                    $action['performed'] = true;
                    $action['result'] = 'sent ' . (int) ($sent['sent'] ?? 0) . ', failed ' . (int) ($sent['failed'] ?? 0);
                } catch (\Throwable $e) {
                    $action['result'] = 'failed: ' . $e->getMessage();
                }
            }
            $actions[] = $action;
        }

        foreach (self::NEVER_TOUCHED as $bucket => $reason) {
            $amount = round((float) ($buckets[$bucket]['amount'] ?? ($result['breakdown']['diagnostics'][$bucket]['amount'] ?? 0)), 4);
            if (abs($amount) >= self::TOLERANCE) {
                $skipped[] = ['bucket' => $bucket, 'amount' => $amount, 'reason' => $reason];
            }
        }

        if (!$dryRun && $actions !== []) {
            try {
                $this->audit->log($cmpId, 'reconciliation_heal', 0, 'reconciliation.healed', $actor, [
                    'fy_id' => $fyId, 'bo_id' => $boId, 'as_of' => $asOf,
                    'difference' => $result['difference'], 'actions' => $actions, 'skipped' => $skipped,
                ]);
            } catch (\Throwable $e) {
                log_message('error', 'reconciliation heal audit failed for cmp {c}: {m}', ['c' => $cmpId, 'm' => $e->getMessage()]);
            }
        }

        return [
            'dry_run'    => $dryRun,
            'as_of'      => $asOf,
            'difference' => $result['difference'],
            'actions'    => $actions,
            'skipped'    => $skipped,
        ];
    }

    private function undeliveredCount(int $cmpId): int
    {
        $db = \Config\Database::connect();
        if (!SchemaCache::tableExists($db, 'inv_integration_events')) {
            return 0;
        }

        return $db->table('inv_integration_events')
            ->where('cmp_id', $cmpId)
            ->whereIn('status', ['PENDING', 'FAILED'])
            ->countAllResults();
    }
}
