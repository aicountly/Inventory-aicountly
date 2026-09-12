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

    /**
     * GET /pending-quantities/{id} — one pending row (any status) with its settlement trail:
     * every inv_pending_settlements row joined with the document that settled it.
     */
    public function show($id = null)
    {
        $a = $this->authorize('documents.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $pendingId = (int) $id;
        if ($pendingId <= 0) {
            return $this->failStructured(400, 'validation_failed', 'pending id is required');
        }
        $db = \Config\Database::connect();
        $row = $db->table('inv_pending_quantities p')
            ->select('p.*, d.document_no, d.document_date, d.document_type, d.status AS document_status, d.party_name, i.item_name, i.item_sku, u.unit_symbol, w.warehouse_name, (p.qty_original - p.qty_settled) AS qty_open', false)
            ->join('inv_documents d', 'd.document_id = p.document_id', 'left')
            ->join('inv_items i', 'i.item_id = p.item_id', 'left')
            ->join('inv_uom u', 'u.unit_id = p.unit_id', 'left')
            ->join('inv_warehouses w', 'w.warehouse_id = p.warehouse_id', 'left')
            ->where('p.cmp_id', $cmpId)->where('p.pending_id', $pendingId)
            ->get()->getRowArray();
        if (!$row) {
            return $this->failStructured(404, 'not_found', 'Pending quantity not found');
        }
        foreach (['qty_original', 'qty_settled', 'qty_open'] as $k) {
            $row[$k] = round((float) ($row[$k] ?? 0), 4);
        }
        foreach (['pending_id', 'cmp_id', 'fy_id', 'document_id', 'line_id', 'item_id', 'unit_id', 'warehouse_id', 'party_ref'] as $k) {
            if (array_key_exists($k, $row) && $row[$k] !== null) {
                $row[$k] = (int) $row[$k];
            }
        }
        $row['document_type_label'] = \Config\DocumentTypeRegistry::get((string) ($row['document_type'] ?? ''))['label'] ?? $row['document_type'];

        $settlements = $db->table('inv_pending_settlements s')
            ->select('s.settlement_id, s.settle_document_id, s.settle_line_id, s.settlement_type, s.qty_settled, s.created_at, d.document_no, d.document_type, d.document_date, d.status AS document_status, d.source_app, d.source_document_no')
            ->join('inv_documents d', 'd.document_id = s.settle_document_id', 'left')
            ->where('s.cmp_id', $cmpId)->where('s.pending_id', $pendingId)
            ->orderBy('s.created_at', 'ASC')->orderBy('s.settlement_id', 'ASC')
            ->get()->getResultArray();
        foreach ($settlements as &$s) {
            foreach (['settlement_id', 'settle_document_id', 'settle_line_id'] as $k) {
                $s[$k] = $s[$k] === null ? null : (int) $s[$k];
            }
            $s['qty_settled'] = round((float) $s['qty_settled'], 4);
            $s['document_type_label'] = $s['document_type'] !== null ? (\Config\DocumentTypeRegistry::get((string) $s['document_type'])['label'] ?? $s['document_type']) : null;
        }
        unset($s);
        $row['settlements'] = $settlements;

        return $this->respond(['data' => $row]);
    }
}
