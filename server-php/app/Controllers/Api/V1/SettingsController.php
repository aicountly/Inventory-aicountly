<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\AuditService;
use App\Services\InventorySettingsService;
use Config\DocumentTypeRegistry;

class SettingsController extends BaseController
{
    public function show($id = null)
    {
        $a = $this->authorize('settings.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $svc = new InventorySettingsService();

        // The landed-cost policy is stored as one column (the excluded set) and read as a set, so
        // the settings screen is handed the resolved shape rather than left to parse the column and
        // reinvent which types exist and which of them are not switchable.
        return $this->respond(['data' => $svc->get($cmpId) + ['landed_cost_policy' => $svc->landedCostPolicy($cmpId)]]);
    }

    public function update($id = null)
    {
        $a = $this->authorize('settings.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $svc = new InventorySettingsService();
        $before = $svc->get($cmpId);
        try {
            // A rejected value (non_creditable_tax, which is not a switch, or a word outside the
            // vocabulary) is a 422 naming it, not a 500. Nothing is written when it throws: the
            // whole patch is normalised before the single UPDATE runs.
            $after = $svc->update($cmpId, $this->request->getJSON(true) ?? [], $a['session']['uuid']);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
        (new AuditService())->log($cmpId, 'settings', $cmpId, 'settings.update', $a['session']['uuid'], [], $before, $after);

        return $this->respond(['data' => $after + ['landed_cost_policy' => $svc->landedCostPolicy($cmpId)]]);
    }

    /**
     * GET /v1/settings/landed-cost-policy — which landed cost types this company capitalises.
     *
     * Books reads this so its purchase screen offers only the switched-on types; the Inventory
     * landed-cost panel reads the same thing. It is deliberately behind `inventory.enter` and not
     * `settings.read`: the caller that needs it is the one entering a document, which is exactly
     * the permission `GET /v1/document-types` is behind for the same reason.
     *
     * Returns `{capitalisable_cost_types, excluded_cost_types, switchable_cost_types,
     * always_capitalised_cost_types, all_cost_types}` — all lists of cost-type codes from
     * `freight | duty | insurance | handling | other | non_creditable_tax`.
     *
     * The list is what a caller should OFFER. It is not what enforces the policy: Inventory refuses
     * an excluded type on the way in (DocumentService::assertCostTypeCapitalisable), because a
     * screen can be cached, stale or skipped by a direct API call and a charge that was accepted
     * and then left out of stock value is a closing stock nobody was told was short.
     */
    public function landedCostPolicy()
    {
        $a = $this->authorize('inventory.enter', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }

        return $this->respond(['data' => (new InventorySettingsService())->landedCostPolicy((int) $a['ctx']['cmp_id'])]);
    }

    public function documentTypes()
    {
        $a = $this->authorize('inventory.enter', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $out = [];
        foreach (DocumentTypeRegistry::TYPES as $code => $spec) {
            // The catalogue is what a caller may work with; an unimplemented type is not offered.
            if (!DocumentTypeRegistry::isImplemented($code)) {
                continue;
            }
            $out[] = ['code' => $code, 'label' => $spec['label'], 'line_mode' => $spec['line_mode'], 'valuation' => $spec['valuation'], 'cogs' => $spec['cogs'], 'native' => $spec['native'], 'legacy_vch_type' => $spec['legacy_vch_type']];
        }

        return $this->respond(['data' => $out]);
    }

    /**
     * GET /document-parties — the parties Inventory's own documents reference.
     *
     * A picker, not a master. Inventory does not own customers, suppliers or job
     * workers: `party_ref` is an opaque Books ledger id and `party_name` is the name
     * captured on the document when it was raised. This reads back exactly those two
     * columns from inv_documents so a register can offer "All parties" instead of
     * asking a reader to type a ledger id — nothing is copied here, nothing is
     * synced, and no screen gains a party record Books does not already own.
     *
     * Capped and ordered by recent activity: a company with ten thousand ledgers gets
     * the ones it has actually moved stock with, which is the whole population a
     * stock register can filter on anyway.
     */
    public function documentParties()
    {
        $a = $this->authorize('documents.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $boId = (int) $a['ctx']['bo_id'];
        $limit = (int) ($this->request->getGet('limit') ?? 500);
        $limit = max(1, min(2000, $limit));

        $db = \Config\Database::connect();
        $sql = 'SELECT d.party_ref, MAX(d.party_name) AS party_name, MAX(d.document_date) AS last_document_date'
            . ' FROM inv_documents d WHERE d.cmp_id = ? AND d.party_ref IS NOT NULL'
            . ($boId > 0 ? ' AND d.bo_id = ?' : '')
            . ' GROUP BY d.party_ref ORDER BY last_document_date DESC NULLS LAST LIMIT ?';
        $binds = $boId > 0 ? [$cmpId, $boId, $limit] : [$cmpId, $limit];

        $rows = array_map(static fn ($r) => [
            'party_ref'  => (int) $r['party_ref'],
            'party_name' => $r['party_name'] !== null && $r['party_name'] !== '' ? $r['party_name'] : null,
        ], $db->query($sql, $binds)->getResultArray());

        // Alphabetical for the picker; the query ordered by recency only to decide
        // WHICH parties make the cap.
        usort($rows, static fn ($x, $y) => strcasecmp(
            (string) ($x['party_name'] ?? '#' . $x['party_ref']),
            (string) ($y['party_name'] ?? '#' . $y['party_ref']),
        ));

        return $this->respond(['data' => $rows]);
    }

    public function periodLocks()
    {
        $a = $this->authorize('settings.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $rows = \Config\Database::connect()->table('inv_period_locks')->where('cmp_id', (int) $a['ctx']['cmp_id'])->orderBy('locked_at', 'DESC')->get()->getResultArray();

        return $this->respond(['data' => $rows]);
    }

    public function lockPeriod()
    {
        $a = $this->authorize('periods.lock', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $body = $this->request->getJSON(true) ?? [];
        $upto = (string) ($body['locked_upto_date'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $upto)) {
            return $this->failStructured(422, 'validation_failed', 'locked_upto_date (YYYY-MM-DD) is required');
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $db = \Config\Database::connect();
        $db->table('inv_period_locks')->insert(['cmp_id' => $cmpId, 'bo_id' => (int) ($body['bo_id'] ?? 0), 'locked_upto_date' => $upto, 'reason' => $body['reason'] ?? null, 'locked_by' => $a['session']['uuid'], 'locked_at' => date('Y-m-d H:i:s')]);
        $id = (int) $db->insertID();
        (new AuditService())->log($cmpId, 'period_lock', $id, 'period.lock', $a['session']['uuid'], ['reason' => $body['reason'] ?? null], null, ['locked_upto_date' => $upto]);

        return $this->respondCreated(['data' => ['lock_id' => $id]]);
    }

    public function releasePeriodLock($id = null)
    {
        $a = $this->authorize('periods.lock', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        \Config\Database::connect()->table('inv_period_locks')->where('cmp_id', $cmpId)->where('lock_id', (int) $id)->where('released_at', null)->update(['released_by' => $a['session']['uuid'], 'released_at' => date('Y-m-d H:i:s')]);
        (new AuditService())->log($cmpId, 'period_lock', (int) $id, 'period.release', $a['session']['uuid']);

        return $this->respond(['data' => ['lock_id' => (int) $id, 'released' => true]]);
    }
}
