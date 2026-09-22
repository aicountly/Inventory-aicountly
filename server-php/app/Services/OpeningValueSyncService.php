<?php

namespace App\Services;

/**
 * Pushes Inventory's resolved opening-stock VALUE for a company/FY to Books, so Books' Stock-in-
 * Hand account can carry a real FY opening instead of staying unset until someone enters one by
 * hand. Company-wide only (bo_id = 0) for now — the only scope production reconciliation itself
 * uses (see ReconciliationService::inventoryOpeningValue()'s own docblock on branch scoping).
 *
 * Pure read of inv_item_openings (via ReconciliationService::inventoryOpeningValue(), the exact
 * figure reconciliation already compares Books against) plus one outbox write — this never
 * touches inv_item_openings itself. Books decides, independently, whether it is safe to apply the
 * pushed value: it never overwrites an opening a human already entered, whatever it says (see
 * AccountOpeningBalanceService::syncOpeningFromInventory() in books-react-app). This service's
 * only job is not to spam that decision on every minor edit — see debounce below.
 *
 * Event: EVENT, following the inventory.fy.carried_forward template exactly (one aggregate fact
 * per change, delivered through the existing outbox — retries, dead-lettering and idempotency by
 * event_uuid all come from there for free). Never the synchronous BooksApiClient path: there is no
 * commit/rollback semantics here, just a fact to publish, same as a master mirror.
 */
class OpeningValueSyncService
{
    public const EVENT = 'inventory.opening.value_set';

    /** Below this the pushed value has not actually moved; skip re-enqueueing. */
    private const UNCHANGED_TOLERANCE = 0.005;

    public function __construct(
        protected ?ReconciliationService $reconciliation = null,
        protected ?OutboxService $outbox = null,
    ) {
        $this->reconciliation ??= new ReconciliationService();
        $this->outbox ??= new OutboxService();
    }

    /**
     * Recomputes the company-wide opening value for this FY and enqueues a push to Books only if
     * it has moved since the last push. Safe to call after every opening-stock write: a company
     * whose items are entered one at a time will not spam Books once its aggregate settles.
     *
     * Never throws — a failure here must not block the caller's opening-stock save. Errors are
     * logged and swallowed, matching how master-mirror and valuation-revision pushes behave
     * elsewhere in this codebase.
     */
    public function syncIfChanged(int $cmpId, int $fyId, int $boId = 0): void
    {
        if ($cmpId <= 0 || $fyId <= 0) {
            return;
        }
        try {
            $value = round($this->reconciliation->inventoryOpeningValue($cmpId, $fyId, $boId), 4);
            $db = \Config\Database::connect();
            $state = $db->table('inv_opening_sync_state')
                ->where('cmp_id', $cmpId)->where('fy_id', $fyId)->where('bo_id', $boId)
                ->get()->getRowArray();

            // A company with no opening stock has nothing to tell Books about, and Books' own
            // guard refuses a zero when there is no row to delete — so the event would be pure
            // outbox noise. At scale that matters: an --all run across 1 lakh companies would
            // queue ~1 lakh no-op events through a dispatcher that drains 300 a minute, holding
            // real events behind them for hours. A zero AFTER a real push is a different thing
            // and still goes: it tells Books to drop the row this sync wrote.
            if ($state === null && abs($value) < self::UNCHANGED_TOLERANCE) {
                return;
            }

            $lastPushed = $state !== null ? (float) $state['last_pushed_value'] : null;
            if ($lastPushed !== null && abs($lastPushed - $value) < self::UNCHANGED_TOLERANCE) {
                return;
            }

            $this->outbox->enqueue($cmpId, self::EVENT, 'opening_value', $cmpId, null, [
                'cmp_id'        => $cmpId,
                'fy_id'         => $fyId,
                'bo_id'         => $boId,
                'opening_value' => $value,
                'computed_at'   => date('Y-m-d H:i:s'),
            ]);

            $now = date('Y-m-d H:i:s');
            if ($state !== null) {
                $db->table('inv_opening_sync_state')
                    ->where('cmp_id', $cmpId)->where('fy_id', $fyId)->where('bo_id', $boId)
                    ->update(['last_pushed_value' => $value, 'last_pushed_at' => $now]);
            } else {
                $db->table('inv_opening_sync_state')->insert([
                    'cmp_id' => $cmpId, 'fy_id' => $fyId, 'bo_id' => $boId,
                    'last_pushed_value' => $value, 'last_pushed_at' => $now,
                ]);
            }
        } catch (\Throwable $e) {
            log_message('error', 'Opening value sync failed for cmp {c} fy {f}: {m}', ['c' => $cmpId, 'f' => $fyId, 'm' => $e->getMessage()]);
        }
    }
}
