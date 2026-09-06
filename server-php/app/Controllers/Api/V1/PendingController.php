<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\PendingQuantityService;

/**
 * /api/v1/pending-quantities — open pending stock: goods out on delivery challan, in on inward
 * challan, with a job worker, or invoiced-but-not-received (deferred purchase).
 *
 * Filters: kind (challan | deferred_purchase | job_work), direction (in | out), party_ref,
 * item_id, warehouse_id, document_id. Rows carry qty_open = qty_original - qty_settled.
 */
class PendingController extends BaseController
{
    private const KINDS = ['challan', 'deferred_purchase', 'job_work'];

    public function index()
    {
        $a = $this->authorize('documents.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $kind = strtolower(trim((string) $this->request->getGet('kind')));
        if ($kind !== '' && !in_array($kind, self::KINDS, true)) {
            return $this->failStructured(400, 'validation_failed', 'kind must be one of ' . implode(', ', self::KINDS), ['allowed' => self::KINDS]);
        }
        $direction = strtolower(trim((string) $this->request->getGet('direction')));
        if ($direction !== '' && !in_array($direction, ['in', 'out'], true)) {
            return $this->failStructured(400, 'validation_failed', 'direction must be in or out');
        }
        $partyRef = (int) $this->request->getGet('party_ref') ?: null;
        $itemId = (int) $this->request->getGet('item_id') ?: null;
        $warehouseId = (int) $this->request->getGet('warehouse_id') ?: null;
        $documentId = (int) $this->request->getGet('document_id') ?: null;
        $p = $this->listParams(100, 1000);

        $rows = (new PendingQuantityService())->listOpen($cmpId, $kind !== '' ? $kind : null, $direction !== '' ? $direction : null, $partyRef, $itemId, $warehouseId);
        if ($documentId !== null) {
            $rows = array_values(array_filter($rows, static fn ($r) => (int) $r['document_id'] === $documentId));
        }
        $total = count($rows);
        $page = array_slice($rows, $p['offset'], $p['limit']);
        foreach ($page as &$r) {
            foreach (['qty_original', 'qty_settled', 'qty_open'] as $k) {
                $r[$k] = round((float) ($r[$k] ?? 0), 4);
            }
            foreach (['pending_id', 'cmp_id', 'fy_id', 'document_id', 'line_id', 'item_id', 'unit_id', 'warehouse_id', 'party_ref'] as $k) {
                if (array_key_exists($k, $r) && $r[$k] !== null) {
                    $r[$k] = (int) $r[$k];
                }
            }
            $r['document_type_label'] = \Config\DocumentTypeRegistry::get((string) ($r['document_type'] ?? ''))['label'] ?? $r['document_type'];
        }
        unset($r);
        $summary = ['qty_open' => 0.0, 'rows' => $total];
        foreach ($rows as $r) {
            $summary['qty_open'] += (float) ($r['qty_open'] ?? 0);
        }
        $summary['qty_open'] = round($summary['qty_open'], 4);

        return $this->respondList($page, $total, $p['limit'], $p['offset'], ['summary' => $summary]);
    }
}
