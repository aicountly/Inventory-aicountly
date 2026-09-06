<?php

namespace App\Services;

use App\Exceptions\InventoryException;

/**
 * Pending quantities: goods out on delivery challan, in on inward challan, sent to a job
 * worker, or invoiced-but-not-yet-received (deferred purchase). Settled by later documents.
 */
class PendingQuantityService
{
    /**
     * @param list<array<string, mixed>> $lines document lines (line_id, item_id, unit_id, warehouse_id, qty)
     */
    public function open(int $cmpId, int $fyId, int $documentId, string $kind, string $direction, ?int $partyRef, array $lines): int
    {
        $db = \Config\Database::connect();
        $now = date('Y-m-d H:i:s');
        $n = 0;
        foreach ($lines as $line) {
            $qty = (float) ($line['qty'] ?? 0);
            $itemId = (int) ($line['item_id'] ?? 0);
            if ($qty <= 0 || $itemId <= 0) {
                continue;
            }
            $db->table('inv_pending_quantities')->insert([
                'cmp_id'       => $cmpId,
                'fy_id'        => $fyId,
                'document_id'  => $documentId,
                'line_id'      => isset($line['line_id']) ? (int) $line['line_id'] : null,
                'pending_kind' => $kind,
                'direction'    => $direction,
                'item_id'      => $itemId,
                'unit_id'      => isset($line['unit_id']) ? (int) $line['unit_id'] : null,
                'warehouse_id' => isset($line['warehouse_id']) && $line['warehouse_id'] ? (int) $line['warehouse_id'] : null,
                'party_ref'    => $partyRef,
                'qty_original' => round($qty, 4),
                'qty_settled'  => 0,
                'status'       => 'open',
                'created_at'   => $now,
                'updated_at'   => $now,
            ]);
            $n++;
        }

        return $n;
    }

    /** @return array<string, mixed>|null */
    public function getOpen(int $cmpId, int $pendingId, ?int $partyRef = null, ?string $kind = null): ?array
    {
        $b = \Config\Database::connect()->table('inv_pending_quantities')
            ->where('cmp_id', $cmpId)->where('pending_id', $pendingId)->whereIn('status', ['open', 'partial']);
        if ($kind !== null) {
            $b->where('pending_kind', $kind);
        }
        if ($partyRef !== null && $partyRef > 0) {
            $b->where('party_ref', $partyRef);
        }

        return $b->get()->getRowArray() ?: null;
    }

    /**
     * Settle explicit pending ids.
     *
     * @param list<array{pending_id:int, qty:float, settlement_type?:string, line_id?:int}> $settlements
     */
    public function settle(int $cmpId, int $settleDocumentId, ?int $partyRef, array $settlements, ?string $kind = null): void
    {
        $db = \Config\Database::connect();
        $now = date('Y-m-d H:i:s');
        foreach ($settlements as $s) {
            $pendingId = (int) ($s['pending_id'] ?? 0);
            $qty = round((float) ($s['qty'] ?? 0), 4);
            if ($pendingId <= 0 || $qty <= 0) {
                continue;
            }
            $pending = $this->getOpen($cmpId, $pendingId, $partyRef, $kind);
            if (!$pending) {
                throw InventoryException::validation('No open pending quantity #' . $pendingId);
            }
            $openQty = round((float) $pending['qty_original'] - (float) $pending['qty_settled'], 4);
            if ($qty > $openQty + 0.0001) {
                throw InventoryException::validation('Settlement qty ' . $qty . ' exceeds open qty ' . $openQty . ' for pending #' . $pendingId, ['pending_id' => $pendingId, 'open_qty' => $openQty]);
            }
            $newSettled = round((float) $pending['qty_settled'] + $qty, 4);
            $status = $newSettled >= (float) $pending['qty_original'] - 0.0001 ? 'settled' : 'partial';
            $db->table('inv_pending_quantities')->where('pending_id', $pendingId)->update(['qty_settled' => $newSettled, 'status' => $status, 'updated_at' => $now]);
            $db->table('inv_pending_settlements')->insert([
                'cmp_id'             => $cmpId,
                'pending_id'         => $pendingId,
                'settle_document_id' => $settleDocumentId,
                'settle_line_id'     => isset($s['line_id']) ? (int) $s['line_id'] : null,
                'settlement_type'    => $s['settlement_type'] ?? null,
                'qty_settled'        => $qty,
                'created_at'         => $now,
            ]);
        }
    }

    /**
     * Settle by (source document, item[, warehouse]) — the shape Books sends for "from challan" invoices.
     *
     * @param list<array{source_document_id:int, item_id:int, qty:float, warehouse_id?:int|null, line_id?:int}> $settlements
     */
    public function settleBySource(int $cmpId, int $settleDocumentId, string $direction, ?int $partyRef, array $settlements, string $kind = 'challan'): void
    {
        $db = \Config\Database::connect();
        foreach ($settlements as $s) {
            $sourceDoc = (int) ($s['source_document_id'] ?? 0);
            $itemId = (int) ($s['item_id'] ?? 0);
            $qty = round((float) ($s['qty'] ?? 0), 4);
            if ($sourceDoc <= 0 || $itemId <= 0 || $qty <= 0) {
                continue;
            }
            $wh = isset($s['warehouse_id']) && $s['warehouse_id'] !== '' && $s['warehouse_id'] !== null ? (int) $s['warehouse_id'] : null;
            $b = $db->table('inv_pending_quantities')
                ->where('cmp_id', $cmpId)->where('document_id', $sourceDoc)->where('item_id', $itemId)
                ->where('direction', $direction)->where('pending_kind', $kind)->whereIn('status', ['open', 'partial'])
                ->orderBy('pending_id', 'ASC');
            if ($wh !== null) {
                $b->where('warehouse_id', $wh);
            }
            if ($partyRef !== null && $partyRef > 0) {
                $b->where('party_ref', $partyRef);
            }
            $rows = $b->get()->getResultArray();
            if ($rows === []) {
                throw InventoryException::validation('No open pending stock for document #' . $sourceDoc . ' item #' . $itemId, ['source_document_id' => $sourceDoc, 'item_id' => $itemId]);
            }
            $remaining = $qty;
            $plan = [];
            foreach ($rows as $row) {
                if ($remaining <= 0.0001) {
                    break;
                }
                $open = round((float) $row['qty_original'] - (float) $row['qty_settled'], 4);
                $take = min($open, $remaining);
                if ($take <= 0) {
                    continue;
                }
                $plan[] = ['pending_id' => (int) $row['pending_id'], 'qty' => $take, 'line_id' => $s['line_id'] ?? null];
                $remaining = round($remaining - $take, 4);
            }
            if ($remaining > 0.0001) {
                throw InventoryException::validation('Settlement qty exceeds open pending qty for document #' . $sourceDoc . ' item #' . $itemId, ['source_document_id' => $sourceDoc, 'item_id' => $itemId, 'short_by' => $remaining]);
            }
            $this->settle($cmpId, $settleDocumentId, $partyRef, $plan, $kind);
        }
    }

    /** Cancel every open pending row a document opened (on reversal). */
    public function cancelForDocument(int $cmpId, int $documentId): int
    {
        $db = \Config\Database::connect();
        $settled = $db->table('inv_pending_quantities')->where('cmp_id', $cmpId)->where('document_id', $documentId)->where('qty_settled >', 0)->countAllResults();
        if ($settled > 0) {
            throw InventoryException::invalidState('Document has pending quantities that were already settled by later documents; reverse those first', ['document_id' => $documentId]);
        }
        $db->table('inv_pending_quantities')->where('cmp_id', $cmpId)->where('document_id', $documentId)->whereIn('status', ['open', 'partial'])->update(['status' => 'cancelled', 'updated_at' => date('Y-m-d H:i:s')]);

        return $db->affectedRows();
    }

    /** Undo settlements a document made (on reversal of the settling document). */
    public function unsettleForDocument(int $cmpId, int $settleDocumentId): int
    {
        $db = \Config\Database::connect();
        $rows = $db->table('inv_pending_settlements')->where('cmp_id', $cmpId)->where('settle_document_id', $settleDocumentId)->get()->getResultArray();
        $n = 0;
        foreach ($rows as $r) {
            $pending = $db->table('inv_pending_quantities')->where('pending_id', (int) $r['pending_id'])->get()->getRowArray();
            if (!$pending) {
                continue;
            }
            $newSettled = max(0.0, round((float) $pending['qty_settled'] - (float) $r['qty_settled'], 4));
            $status = $newSettled <= 0.0001 ? 'open' : 'partial';
            $db->table('inv_pending_quantities')->where('pending_id', (int) $r['pending_id'])->update(['qty_settled' => $newSettled, 'status' => $status, 'updated_at' => date('Y-m-d H:i:s')]);
            $db->table('inv_pending_settlements')->where('settlement_id', (int) $r['settlement_id'])->delete();
            $n++;
        }

        return $n;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function listOpen(int $cmpId, ?string $kind = null, ?string $direction = null, ?int $partyRef = null, ?int $itemId = null, ?int $warehouseId = null): array
    {
        $db = \Config\Database::connect();
        $b = $db->table('inv_pending_quantities p')
            ->select('p.*, d.document_no, d.document_date, d.document_type, i.item_name, u.unit_symbol, w.warehouse_name, (p.qty_original - p.qty_settled) AS qty_open', false)
            ->join('inv_documents d', 'd.document_id = p.document_id', 'left')
            ->join('inv_items i', 'i.item_id = p.item_id', 'left')
            ->join('inv_uom u', 'u.unit_id = p.unit_id', 'left')
            ->join('inv_warehouses w', 'w.warehouse_id = p.warehouse_id', 'left')
            ->where('p.cmp_id', $cmpId)->whereIn('p.status', ['open', 'partial'])
            ->orderBy('d.document_date', 'ASC')->orderBy('p.pending_id', 'ASC');
        if ($kind) {
            $b->where('p.pending_kind', $kind);
        }
        if ($direction) {
            $b->where('p.direction', $direction);
        }
        if ($partyRef) {
            $b->where('p.party_ref', $partyRef);
        }
        if ($itemId) {
            $b->where('p.item_id', $itemId);
        }
        if ($warehouseId) {
            $b->where('p.warehouse_id', $warehouseId);
        }

        return $b->get()->getResultArray();
    }
}
