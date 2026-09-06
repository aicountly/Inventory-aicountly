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

        return $this->respond(['data' => (new InventorySettingsService())->get((int) $a['ctx']['cmp_id'])]);
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
        $after = $svc->update($cmpId, $this->request->getJSON(true) ?? [], $a['session']['uuid']);
        (new AuditService())->log($cmpId, 'settings', $cmpId, 'settings.update', $a['session']['uuid'], [], $before, $after);

        return $this->respond(['data' => $after]);
    }

    public function documentTypes()
    {
        $a = $this->authorize('inventory.enter', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $out = [];
        foreach (DocumentTypeRegistry::TYPES as $code => $spec) {
            $out[] = ['code' => $code, 'label' => $spec['label'], 'line_mode' => $spec['line_mode'], 'valuation' => $spec['valuation'], 'cogs' => $spec['cogs'], 'native' => $spec['native'], 'legacy_vch_type' => $spec['legacy_vch_type']];
        }

        return $this->respond(['data' => $out]);
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
