<?php

namespace App\Services;

use App\Exceptions\InventoryException;
use Config\DocumentTypeRegistry;

/**
 * Inventory document lifecycle: create / update drafts, submit / approve / reject, read.
 * Posting and reversal live in DocumentPostingService.
 */
class DocumentService
{
    public const EDITABLE_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FAILED'];

    /**
     * Document types whose commercial value can still be recorded once the document is posted.
     *
     * JOB_WORK_OUT only, and for a reason that has to hold for anything added here: it is
     * status_only and carries no valuation — the goods never leave the principal's ownership, so
     * nothing was costed — and it is not in DocumentTypeRegistry::COST_BEARING_SOURCE_RATE, so no
     * movement, cost layer, balance or COGS figure anywhere reads its source rate. On a type
     * where the source rate IS the cost (a purchase, a GRN, an opening) the same write would
     * silently re-price closing stock. A JOB_WORK_IN stays out for the other half of the test: it
     * moves and values stock, and it needs no door anyway — Books' item lines carried rate and
     * amount, so a receipt arrives from the migration with the value its challan declared.
     */
    public const VALUE_AMENDABLE_TYPES = ['JOB_WORK_OUT'];

    /** Live posted statuses, the ones a challan value can still be recorded against. */
    public const VALUE_AMENDABLE_STATUSES = ['POSTED', 'PARTIALLY_FULFILLED', 'COMPLETED'];

    /**
     * Landed cost vocabulary, shared by the per-line field Books posts with a receipt and by the
     * charges a LANDED_COST document carries.
     *
     * 'weight' is deliberately absent as a basis: there is no item weight master to allocate by, so
     * offering it would be a control that silently falls back to something else. 'direct' is the
     * charge that belongs to exactly one line by nature — a non-creditable tax is the case that
     * needs it, because the tax that cannot be claimed is the tax on that one line.
     *
     * 'equal' splits a charge evenly over the lines rather than by any property of them. It is the
     * honest basis for a per-consignment fee that the lines did not earn in proportion to anything
     * Inventory holds — a documentation or inspection charge is the same rupees whether the crate
     * holds one line or ten — and without it that charge had to be entered by hand on every line,
     * which is the same arithmetic done less reliably.
     */
    public const LANDED_COST_TYPES = ['freight', 'duty', 'insurance', 'handling', 'other', 'non_creditable_tax'];

    public const LANDED_COST_BASES = ['value', 'qty', 'equal', 'manual', 'direct'];

    public function __construct(
        protected ?UnitConversionService $units = null,
        protected ?AuditService $audit = null,
        protected ?InventorySettingsService $settings = null,
    ) {
        $this->units ??= new UnitConversionService();
        $this->audit ??= new AuditService();
        $this->settings ??= new InventorySettingsService();
    }

    /**
     * Create a document (status DRAFT) from an API payload.
     *
     * @param array<string, mixed> $ctx  cmp_id, fy_id, bo_id
     * @param array<string, mixed> $payload
     * @return array<string, mixed> document with lines
     */
    public function create(array $ctx, array $payload, ?string $actor, string $sourceApp = 'inventory'): array
    {
        $type = strtoupper(trim((string) ($payload['document_type'] ?? '')));
        $spec = DocumentTypeRegistry::get($type);
        if ($spec === null) {
            throw InventoryException::validation('Unknown document_type ' . $type, ['allowed' => DocumentTypeRegistry::all()]);
        }
        if (!DocumentTypeRegistry::isImplemented($type)) {
            throw InventoryException::validation($spec['label'] . ' is not available: the type is declared but nothing happens when it posts, so the document would record work it never did', ['document_type' => $type]);
        }
        $cmpId = (int) $ctx['cmp_id'];
        $db = \Config\Database::connect();
        $now = date('Y-m-d H:i:s');
        $header = $this->headerFromPayload($cmpId, (int) $ctx['fy_id'], (int) $ctx['bo_id'], $type, $payload, $sourceApp);
        $lines = $this->normalizeLines($cmpId, $type, $spec, $payload, $header);
        if ($lines === [] && !in_array($spec['line_mode'], ['status_only'], true)) {
            throw InventoryException::validation('At least one item line is required');
        }

        $db->transStart();
        try {
            $header['created_by'] = $actor;
            $header['created_at'] = $now;
            $header['updated_by'] = $actor;
            $header['updated_at'] = $now;
            $header['status'] = 'DRAFT';
            DatabaseInsertHelper::insert($db, 'inv_documents', $header);
            $documentId = (int) $db->insertID();
            $this->writeLines($db, $documentId, $cmpId, (int) $ctx['fy_id'], (int) $ctx['bo_id'], $lines);
            $db->transComplete();
            if ($db->transStatus() === false) {
                throw new \RuntimeException('Could not create document', 500);
            }
        } catch (\Throwable $e) {
            $db->transRollback();
            $db->resetTransStatus();
            if (str_contains($e->getMessage(), 'uq_inv_documents_source')) {
                throw InventoryException::conflict('An inventory document already exists for this source document', ['source_document_type' => $header['source_document_type'], 'source_document_id' => $header['source_document_id']]);
            }
            throw $e;
        }
        $this->audit->log($cmpId, 'document', $documentId, 'document.create', $actor, ['source_app' => $sourceApp], null, ['document_type' => $type, 'lines' => count($lines)]);

        return $this->get($cmpId, $documentId);
    }

    /** @param array<string, mixed> $payload */
    public function update(int $cmpId, int $documentId, array $payload, ?string $actor): array
    {
        $doc = $this->get($cmpId, $documentId);
        if (!in_array($doc['status'], self::EDITABLE_STATUSES, true)) {
            throw InventoryException::invalidState('Only draft / approved documents can be edited (status ' . $doc['status'] . ')');
        }
        $type = (string) $doc['document_type'];
        $spec = DocumentTypeRegistry::get($type);
        $db = \Config\Database::connect();
        $header = $this->headerFromPayload($cmpId, (int) $doc['fy_id'], (int) $doc['bo_id'], $type, array_merge($doc, $payload), (string) $doc['source_app']);
        unset($header['document_uuid'], $header['status'], $header['source_app']);
        $lines = $this->normalizeLines($cmpId, $type, $spec, array_merge($doc, $payload), $header);
        $db->transStart();
        try {
            $header['updated_by'] = $actor;
            $header['updated_at'] = date('Y-m-d H:i:s');
            $header['version'] = (int) $doc['version'] + 1;
            if ($doc['status'] === 'APPROVED' || $doc['status'] === 'PENDING_APPROVAL') {
                $header['status'] = 'DRAFT'; // an edit invalidates the approval
                $header['approved_by'] = null;
                $header['approved_at'] = null;
            }
            $db->table('inv_documents')->where('document_id', $documentId)->where('cmp_id', $cmpId)->update($header);
            $db->table('inv_document_line_serials')->where('document_id', $documentId)->delete();
            $db->table('inv_document_lines')->where('document_id', $documentId)->delete();
            $this->writeLines($db, $documentId, $cmpId, (int) $doc['fy_id'], (int) $doc['bo_id'], $lines);
            $db->transComplete();
        } catch (\Throwable $e) {
            $db->transRollback();
            $db->resetTransStatus();
            throw $e;
        }
        $this->audit->log($cmpId, 'document', $documentId, 'document.update', $actor, [], ['version' => $doc['version']], ['version' => $header['version']]);

        return $this->get($cmpId, $documentId);
    }

    /**
     * Record the challan value of a job-work dispatch that has already been posted.
     *
     * Table 4 of FORM GST ITC-04 declares the value the goods went out at, and Books never
     * captured one: books_voucher_job_work_lines holds item, unit, qty and material centre only,
     * so every Job Work Out the migration moved out of Books arrives here POSTED and worth
     * nothing. Books has no job-work screen left to type it on — vch_type 6/7 are refused at
     * draft time — and a posted document is outside EDITABLE_STATUSES, so without this the
     * quarter can never be completed and the return never filed. revise() is not the answer: it
     * reverses and re-creates under a new document_id, reopening the pending quantities a later
     * JOB_WORK_IN already settled.
     *
     * Nothing is posted here, so the period lock — which guards postings — has nothing to guard.
     *
     * @param array<string, mixed> $payload lines: [{line_id, rate?, amount?}, ...]
     * @return array<string, mixed>
     */
    public function amendChallanValue(int $cmpId, int $documentId, array $payload, ?string $actor): array
    {
        $doc = $this->get($cmpId, $documentId);
        $writes = $this->challanValueWrites($doc, $payload);
        $before = [];
        foreach ($doc['lines'] as $line) {
            $lineId = (int) $line['line_id'];
            if (isset($writes[$lineId])) {
                $before[$lineId] = ['source_transaction_rate' => $line['source_transaction_rate'] ?? null, 'source_transaction_amount' => $line['source_transaction_amount'] ?? null];
            }
        }
        $db = \Config\Database::connect();
        $db->transStart();
        try {
            foreach ($writes as $lineId => $set) {
                $db->table('inv_document_lines')->where('line_id', $lineId)->where('document_id', $documentId)->where('cmp_id', $cmpId)->update($set);
            }
            $db->table('inv_documents')->where('document_id', $documentId)->where('cmp_id', $cmpId)->update([
                'version' => (int) $doc['version'] + 1, 'updated_by' => $actor, 'updated_at' => date('Y-m-d H:i:s'),
            ]);
            $db->transComplete();
            // DBDebug is off, so a refused UPDATE returns false instead of throwing and the
            // rollback is silent. Without this the audit row below would assert a Table 4 figure
            // that no line ever carried, append-only and kept for eight years.
            if ($db->transStatus() === false) {
                throw new \RuntimeException('Could not record the challan value', 500);
            }
        } catch (\Throwable $e) {
            $db->transRollback();
            $db->resetTransStatus();

            throw $e;
        }
        $this->audit->log($cmpId, 'document', $documentId, 'document.challan_value', $actor, ['lines' => count($writes)], $before, $writes);

        return $this->get($cmpId, $documentId);
    }

    /**
     * The columns a value amendment is allowed to write, by line_id — and the whole of what it
     * may touch. Only the commercial pair appears here: a valuation figure is what the stock
     * cost, on a basis no challan declares, and letting one in through this door is the exact
     * confusion the Books / Inventory split exists to prevent.
     *
     * @param array<string, mixed> $doc
     * @param array<string, mixed> $payload
     * @return array<int, array{source_transaction_rate: float, source_transaction_amount: float}>
     */
    protected function challanValueWrites(array $doc, array $payload): array
    {
        $type = strtoupper((string) $doc['document_type']);
        $status = (string) $doc['status'];
        if (!in_array($type, self::VALUE_AMENDABLE_TYPES, true)) {
            throw InventoryException::invalidState('A ' . $type . ' carries no challan value that can be recorded after posting; its value is part of the document');
        }
        if (in_array($status, self::EDITABLE_STATUSES, true)) {
            throw InventoryException::invalidState('This document is still editable — put the value on the document itself (status ' . $status . ')');
        }
        if (!in_array($status, self::VALUE_AMENDABLE_STATUSES, true)) {
            throw InventoryException::invalidState('A ' . $status . ' document has no challan value to record');
        }
        $byLineId = [];
        foreach ($doc['lines'] as $line) {
            $byLineId[(int) $line['line_id']] = $line;
        }
        $writes = [];
        foreach (is_array($payload['lines'] ?? null) ? $payload['lines'] : [] as $idx => $in) {
            $in = (array) $in;
            $lineId = (int) ($in['line_id'] ?? 0);
            if (!isset($byLineId[$lineId])) {
                throw InventoryException::validation('Line ' . ((int) $idx + 1) . ': line #' . $lineId . ' is not on this document', ['line_id' => $lineId]);
            }
            $qty = (float) ($byLineId[$lineId]['qty'] ?? 0);
            $rate = (float) ($in['rate'] ?? 0);
            $amount = (float) ($in['amount'] ?? 0);
            if ($amount <= 0 && $rate > 0) {
                $amount = round($qty * $rate, 4);
            }
            if ($rate <= 0 && $amount > 0 && $qty > 0) {
                $rate = round($amount / $qty, 4);
            }
            // Clearing a value is not an amendment, it is the return quietly losing its Table 4
            // figure again. Correcting one positive value to another is what this is for.
            if ($amount <= 0) {
                throw InventoryException::validation('Line ' . ((int) $idx + 1) . ': a challan value greater than zero is required', ['line_id' => $lineId]);
            }
            $writes[$lineId] = ['source_transaction_rate' => round($rate, 4), 'source_transaction_amount' => round($amount, 4)];
        }
        if ($writes === []) {
            throw InventoryException::validation('No line values to record');
        }

        return $writes;
    }

    public function submit(int $cmpId, int $documentId, ?string $actor, ?string $notes = null): array
    {
        return $this->transition($cmpId, $documentId, ['DRAFT', 'FAILED'], 'PENDING_APPROVAL', 'submitted', $actor, $notes);
    }

    public function approve(int $cmpId, int $documentId, ?string $actor, ?string $notes = null): array
    {
        $doc = $this->transition($cmpId, $documentId, ['DRAFT', 'PENDING_APPROVAL'], 'APPROVED', 'approved', $actor, $notes);
        \Config\Database::connect()->table('inv_documents')->where('document_id', $documentId)->update(['approved_by' => $actor, 'approved_at' => date('Y-m-d H:i:s')]);

        return $this->get($cmpId, $documentId);
    }

    public function reject(int $cmpId, int $documentId, ?string $actor, ?string $notes = null): array
    {
        return $this->transition($cmpId, $documentId, ['PENDING_APPROVAL', 'APPROVED'], 'DRAFT', 'rejected', $actor, $notes);
    }

    public function cancelDraft(int $cmpId, int $documentId, ?string $actor, ?string $reason = null): array
    {
        $doc = $this->get($cmpId, $documentId);
        if (!in_array($doc['status'], self::EDITABLE_STATUSES, true)) {
            throw InventoryException::invalidState('Posted documents must be reversed, not cancelled');
        }
        \Config\Database::connect()->table('inv_documents')->where('document_id', $documentId)->update([
            'status' => 'CANCELLED', 'cancelled_by' => $actor, 'cancelled_at' => date('Y-m-d H:i:s'), 'cancel_reason' => $reason, 'updated_at' => date('Y-m-d H:i:s'),
        ]);
        $this->audit->log($cmpId, 'document', $documentId, 'document.cancel', $actor, ['reason' => $reason]);

        return $this->get($cmpId, $documentId);
    }

    /** @return array<string, mixed> */
    public function get(int $cmpId, int $documentId): array
    {
        $db = \Config\Database::connect();
        $doc = $db->table('inv_documents')->where('cmp_id', $cmpId)->where('document_id', $documentId)->get()->getRowArray();
        if (!$doc) {
            throw InventoryException::notFound('Document not found');
        }

        return $this->hydrate($doc);
    }

    /** @return array<string, mixed>|null */
    public function findBySource(int $cmpId, string $sourceApp, string $sourceDocumentType, int $sourceDocumentId): ?array
    {
        $db = \Config\Database::connect();
        $doc = $db->table('inv_documents')->where('cmp_id', $cmpId)->where('source_app', $sourceApp)
            ->where('source_document_type', $sourceDocumentType)->where('source_document_id', $sourceDocumentId)
            ->whereNotIn('status', ['CANCELLED', 'REVERSED', 'FAILED'])
            ->orderBy('document_id', 'DESC')->get()->getRowArray();

        return $doc ? $this->hydrate($doc) : null;
    }

    /** @return array<string, mixed>|null */
    public function findByUuid(int $cmpId, string $uuid): ?array
    {
        $doc = \Config\Database::connect()->table('inv_documents')->where('cmp_id', $cmpId)->where('document_uuid', $uuid)->get()->getRowArray();

        return $doc ? $this->hydrate($doc) : null;
    }

    /** @return array<string, mixed> */
    public function hydrate(array $doc): array
    {
        $db = \Config\Database::connect();
        $documentId = (int) $doc['document_id'];
        $lines = $this->loadLines([$documentId])[$documentId] ?? [];
        $doc['metadata'] = json_decode((string) ($doc['metadata_json'] ?? ''), true) ?: null;
        $doc['accounting_effects'] = json_decode((string) ($doc['accounting_effects_json'] ?? ''), true) ?: [];
        unset($doc['metadata_json'], $doc['accounting_effects_json']);
        $doc['lines'] = $lines;
        $doc['approvals'] = $db->table('inv_document_approvals')->select('approval_id, action, actor_uuid, notes, created_at')
            ->where('document_id', (int) $doc['document_id'])->orderBy('created_at', 'ASC')->orderBy('approval_id', 'ASC')->get()->getResultArray();
        foreach ($doc['approvals'] as &$approval) {
            $approval['approval_id'] = (int) $approval['approval_id'];
        }
        unset($approval);
        $spec = DocumentTypeRegistry::get((string) $doc['document_type']);
        $doc['document_type_label'] = $spec['label'] ?? $doc['document_type'];

        return $doc;
    }

    /**
     * Lines for a set of documents in one read.
     *
     * A caller that wants many documents' lines and nothing else — Books building ITC-04 out of a
     * whole quarter of job-work challans — would otherwise fetch each document on its own, one
     * HTTP round trip and one API timeout of exposure per document.
     *
     * @param list<int|string> $documentIds
     * @return array<int, list<array<string, mixed>>> document_id => lines
     */
    public function linesForDocuments(int $cmpId, array $documentIds): array
    {
        $ids = [];
        foreach ($documentIds as $id) {
            $id = (int) $id;
            if ($id > 0) {
                $ids[$id] = $id;
            }
        }

        return $this->loadLines(array_values($ids), $cmpId);
    }

    // ------------------------------------------------------------------ helpers

    /**
     * @param list<int> $documentIds
     * @return array<int, list<array<string, mixed>>> document_id => lines
     */
    private function loadLines(array $documentIds, ?int $cmpId = null): array
    {
        if ($documentIds === []) {
            return [];
        }
        $db = \Config\Database::connect();
        $b = $db->table('inv_document_lines l')
            ->select('l.*, i.item_name, i.print_name AS item_print_name, i.item_sku, u.unit_symbol, u.unit_name, w.warehouse_name, dw.warehouse_name AS dest_warehouse_name, b.batch_no, b.expiry_date')
            ->join('inv_items i', 'i.item_id = l.item_id', 'left')
            ->join('inv_uom u', 'u.unit_id = l.unit_id', 'left')
            ->join('inv_warehouses w', 'w.warehouse_id = l.warehouse_id', 'left')
            ->join('inv_warehouses dw', 'dw.warehouse_id = l.dest_warehouse_id', 'left')
            ->join('inv_batches b', 'b.batch_id = l.batch_id', 'left')
            ->whereIn('l.document_id', $documentIds);
        // Only the cross-document read needs this: hydrate() has already established the company
        // by reading the header, while an id list arrives straight off a request.
        if ($cmpId !== null) {
            $b->where('l.cmp_id', $cmpId);
        }
        $lines = $b->orderBy('l.document_id', 'ASC')->orderBy('l.sort_order', 'ASC')->orderBy('l.line_id', 'ASC')
            ->get()->getResultArray();
        $serials = $db->table('inv_document_line_serials ls')->select('ls.line_id, s.serial_id, s.serial_no')->join('inv_serials s', 's.serial_id = ls.serial_id', 'left')
            ->whereIn('ls.document_id', $documentIds)->get()->getResultArray();
        $byLine = [];
        foreach ($serials as $s) {
            $byLine[(int) $s['line_id']][] = ['serial_id' => (int) $s['serial_id'], 'serial_no' => $s['serial_no']];
        }
        $out = [];
        foreach ($lines as $line) {
            $line['metadata'] = json_decode((string) ($line['metadata_json'] ?? ''), true) ?: null;
            unset($line['metadata_json']);
            foreach (['qty', 'base_qty', 'conversion_factor', 'source_transaction_rate', 'source_transaction_amount', 'valuation_rate', 'valuation_amount', 'landed_cost_amount', 'book_qty', 'physical_qty'] as $k) {
                if (array_key_exists($k, $line) && $line[$k] !== null) {
                    $line[$k] = (float) $line[$k];
                }
            }
            $line['item_label'] = $line['item_print_name'] ?: $line['item_name'];
            $line['serials'] = $byLine[(int) $line['line_id']] ?? [];
            $out[(int) $line['document_id']][] = $line;
        }

        return $out;
    }

    // ------------------------------------------------------------------ landed cost

    /**
     * The landed cost carried on ONE payload line: the rupee amount Books allocated to it, plus the
     * breakdown that says which charges it is made of.
     *
     * Books owns the charges (a freight bill is a payable) and allocates them; Inventory consumes
     * the per-line amount as part of the cost of the goods. Nothing here reads or writes
     * source_transaction_rate / source_transaction_amount: the landed cost is a COST, so it may
     * never change the invoice value, the taxable value or any GST figure.
     *
     * Reads the amount from `landed_cost_amount` and the breakdown from `landed_cost_breakdown` or
     * from `metadata.landed_cost_breakdown`, because a stored line comes back with the breakdown
     * inside its metadata and normalizeLines() runs over stored lines again on every update().
     *
     * @param array<string, mixed> $line
     * @return array{amount: float, breakdown: list<array{cost_type: string, amount: float, allocation_basis: string}>}
     */
    public static function landedCostFromLine(array $line, int $lineNo): array
    {
        $raw = $line['landed_cost_amount'] ?? null;
        $rawBreakdown = $line['landed_cost_breakdown'] ?? null;
        if ($rawBreakdown === null && isset($line['metadata']) && is_array($line['metadata'])) {
            $rawBreakdown = $line['metadata']['landed_cost_breakdown'] ?? null;
        }
        if (($raw === null || $raw === '') && !is_array($rawBreakdown)) {
            return ['amount' => 0.0, 'breakdown' => []];
        }
        if ($raw !== null && $raw !== '' && !is_numeric($raw)) {
            throw InventoryException::validation('Line ' . $lineNo . ': landed_cost_amount must be a number', ['landed_cost_amount' => $raw]);
        }
        $amount = round((float) ($raw ?? 0), 4);
        if ($amount < 0) {
            throw InventoryException::validation('Line ' . $lineNo . ': landed_cost_amount cannot be negative (' . $amount . ')', ['landed_cost_amount' => $amount]);
        }
        $breakdown = [];
        $sum = 0.0;
        if ($rawBreakdown !== null) {
            if (!is_array($rawBreakdown)) {
                throw InventoryException::validation('Line ' . $lineNo . ': landed_cost_breakdown must be a list of charges');
            }
            foreach ($rawBreakdown as $entry) {
                if (!is_array($entry)) {
                    throw InventoryException::validation('Line ' . $lineNo . ': each landed_cost_breakdown entry must be an object with cost_type, amount and allocation_basis');
                }
                $part = self::landedCostPart($entry, 'Line ' . $lineNo);
                $breakdown[] = $part;
                $sum = round($sum + $part['amount'], 4);
            }
        }
        // 0.01 is one paisa: the tolerance Books' own allocator rounds to. Anything wider hides a
        // charge that was only partly sent, and a landed cost that is quietly short is a closing
        // stock that does not tie.
        if ($breakdown !== [] && abs($sum - $amount) > 0.01) {
            throw InventoryException::validation(
                'Line ' . $lineNo . ': landed_cost_breakdown sums to ' . number_format($sum, 4, '.', '') . ' but landed_cost_amount is ' . number_format($amount, 4, '.', ''),
                ['breakdown_total' => $sum, 'landed_cost_amount' => $amount],
            );
        }

        return ['amount' => $amount, 'breakdown' => $breakdown];
    }

    /**
     * One charge, validated against the two enums. Used for a breakdown entry on a receipt line and
     * for a charge on a LANDED_COST document, so the vocabulary cannot drift between them.
     *
     * @param array<string, mixed> $entry
     * @return array{cost_type: string, amount: float, allocation_basis: string}
     */
    private static function landedCostPart(array $entry, string $where): array
    {
        $costType = strtolower(trim((string) ($entry['cost_type'] ?? '')));
        if (!in_array($costType, self::LANDED_COST_TYPES, true)) {
            throw InventoryException::validation(
                $where . ': cost_type "' . $costType . '" is not one of ' . implode(', ', self::LANDED_COST_TYPES),
                ['cost_type' => $costType, 'allowed' => self::LANDED_COST_TYPES],
            );
        }
        $basis = strtolower(trim((string) ($entry['allocation_basis'] ?? '')));
        if ($basis === '') {
            $basis = 'value';
        }
        if (!in_array($basis, self::LANDED_COST_BASES, true)) {
            throw InventoryException::validation(
                $where . ': allocation_basis "' . $basis . '" is not one of ' . implode(', ', self::LANDED_COST_BASES) . ' (weight is not offered: there is no item weight master to allocate by)',
                ['allocation_basis' => $basis, 'allowed' => self::LANDED_COST_BASES],
            );
        }
        $amount = round((float) ($entry['amount'] ?? 0), 4);
        if ($amount < 0) {
            throw InventoryException::validation($where . ': a ' . $costType . ' charge cannot be negative (' . $amount . ')', ['cost_type' => $costType, 'amount' => $amount]);
        }

        return ['cost_type' => $costType, 'amount' => $amount, 'allocation_basis' => $basis];
    }

    /**
     * The company's capitalisation policy, asked of ONE charge.
     *
     * Deciding which charges are part of the cost of inventory — freight, insurance, customs, a
     * tax that cannot be claimed — is an accounting policy of the company that holds the stock. It
     * is not a per-voucher decision and it is not Books' to make: Books captures the charge and
     * allocates it, Inventory decides whether that kind of charge belongs in stock value at all.
     *
     * Books is told which types are switched on (GET /v1/settings/landed-cost-policy) so its
     * purchase screen offers only those, but that offer is a courtesy and not the control. A screen
     * can be stale, cached, or skipped entirely by a direct API call, so the refusal has to live
     * here, on the way in, where every caller passes.
     *
     * It is a REFUSAL and never a drop. Accepting the line and quietly leaving the amount out would
     * be a closing stock short by exactly that amount with nobody told — the same failure the whole
     * split of ownership exists to prevent, and one already found by probe on another path in this
     * project. The caller is told the type and the policy and can either change the policy or take
     * the charge off the voucher and expense it, which is what excluding a type MEANS.
     *
     * @param list<string> $capitalisable InventorySettingsService::capitalisableLandedCostTypes()
     */
    public static function assertCostTypeCapitalisable(string $costType, array $capitalisable, string $where): void
    {
        if (in_array($costType, $capitalisable, true)) {
            return;
        }

        throw InventoryException::validation(
            $where . ': this company does not capitalise ' . $costType . ' into the cost of stock, so the amount cannot be accepted here — accepting it and leaving it out '
            . 'would make closing stock short by exactly that amount with nobody told. Expense the charge in Books, or switch ' . $costType
            . ' back on in Inventory settings (Landed cost capitalised into stock).',
            ['cost_type' => $costType, 'capitalisable_cost_types' => array_values($capitalisable), 'setting' => 'landed_cost_excluded_types'],
        );
    }

    /**
     * The company's capitalisation policy, asked of ONE receipt line's landed cost.
     *
     * A line that carries an amount and NO breakdown is checked against 'other', because that is
     * exactly what posting records it as (DocumentPostingService::receiptBorneShares books an
     * un-attributed amount as one 'other' charge belonging directly to the line). A company that
     * has switched 'other' off has said it does not capitalise charges it cannot name, and letting
     * an unnamed amount through under that very name would make the setting a lie. The refusal
     * says so and asks for the breakdown.
     *
     * @param list<array{cost_type: string, amount: float, allocation_basis: string}> $breakdown
     * @param list<string> $capitalisable
     */
    public static function assertLandedCostPolicy(float $amount, array $breakdown, array $capitalisable, string $where): void
    {
        if ($amount <= 0 && $breakdown === []) {
            return;
        }
        foreach ($breakdown as $part) {
            self::assertCostTypeCapitalisable((string) $part['cost_type'], $capitalisable, $where);
        }
        if ($breakdown === [] && !in_array('other', $capitalisable, true)) {
            throw InventoryException::validation(
                $where . ': a landed cost with no breakdown is capitalised as an "other" charge, and this company does not capitalise other into the cost of stock. '
                . 'Send landed_cost_breakdown naming the charges, or take the amount off the line.',
                ['cost_type' => 'other', 'landed_cost_amount' => $amount, 'capitalisable_cost_types' => array_values($capitalisable), 'setting' => 'landed_cost_excluded_types'],
            );
        }
    }

    /**
     * Where a landed cost may be carried at all. Checked per EMITTED row, not per payload line, so
     * the out leg a transfer generates from one entered line is caught too.
     *
     * It is never silently dropped. A dropped cost is a closing stock that is short by exactly that
     * amount with nobody told — the failure this whole split of ownership exists to prevent — so a
     * landed cost in the wrong place is a 422 that says which place and why.
     *
     * The last of the three questions is the document's, not the type's, and it has to be asked
     * separately from the first: a defer_inward purchase and a from_physical_challan sales return
     * both declare valuation => true and both emit an inward row, so the first two questions pass —
     * but neither moves any stock when it posts, so posting skips its whole valuation block and the
     * amount vanishes. The goods enter later on the settling challan, which costs them from the
     * purchase's RATE (deferredPurchaseUnitCost reads no landed cost) and opens the layer without
     * the charge. That is the silent drop this guard exists to make impossible, so the stock_effect
     * is part of the question and DocumentPostingService::capitalisesLandedCost() is the one place
     * that answers it for both ends.
     *
     * @param array<string, mixed>|null $spec
     */
    public static function assertLandedCostAllowed(string $type, ?array $spec, string $stockEffect, string $direction, float $amount, int $lineNo): void
    {
        if ($amount <= 0) {
            return;
        }
        $label = (string) ($spec['label'] ?? $type);
        if (empty($spec['valuation'])) {
            throw InventoryException::validation(
                'Line ' . $lineNo . ': a landed cost is part of what the stock cost, and ' . $label . ' does not carry valuation, so the amount would be dropped and closing stock would be short by it. Send the charge as a LANDED_COST document against the receipt that values the goods.',
                ['document_type' => $type, 'landed_cost_amount' => $amount],
            );
        }
        if ($direction !== 'in') {
            throw InventoryException::validation(
                'Line ' . $lineNo . ': a landed cost is the cost of getting goods IN, so it cannot be carried on an outward line of ' . $label . '.',
                ['document_type' => $type, 'direction' => $direction, 'landed_cost_amount' => $amount],
            );
        }
        if (!DocumentPostingService::capitalisesLandedCost($type, $spec, $stockEffect)) {
            throw InventoryException::validation(
                'Line ' . $lineNo . ': this ' . $label . ' is ' . ($stockEffect !== '' ? $stockEffect : 'not moving its stock now')
                . ', so it moves no stock when it posts and never values this line — the landed cost would be dropped and closing stock would be short by it. '
                . 'The goods are valued by the document that actually receives them, so send the charge as a LANDED_COST document against that one once it is posted.',
                ['document_type' => $type, 'stock_effect' => $stockEffect, 'direction' => $direction, 'landed_cost_amount' => $amount],
            );
        }
    }

    /**
     * The receipts a LANDED_COST document loads.
     *
     * `metadata.target_document_ids` is a list; `metadata.target_document_id` is the single-receipt
     * shape every document written before this method existed carries, and it is still accepted —
     * a stored draft, an integration payload or a Books-side caller must not stop working because
     * the screen learned to select two. Both are read, the union is returned in the order given,
     * and a receipt named twice is one receipt: a duplicate would otherwise double the weight of
     * every one of its lines in a pro-rata split and hand it twice the charge.
     *
     * One freight bill covering a consignment that arrived over two GRNs is the case this exists
     * for. Splitting it into two documents by hand means inventing a division of the bill before
     * the allocator gets to make one, which is the arithmetic this screen is for.
     *
     * @param array<string, mixed> $metadata
     * @return list<int>
     */
    public static function landedCostTargets(array $metadata): array
    {
        $ids = [];
        $raw = $metadata['target_document_ids'] ?? null;
        if (is_array($raw)) {
            foreach ($raw as $entry) {
                $id = (int) (is_array($entry) ? ($entry['document_id'] ?? 0) : $entry);
                if ($id > 0 && !in_array($id, $ids, true)) {
                    $ids[] = $id;
                }
            }
        }
        $single = (int) ($metadata['target_document_id'] ?? 0);
        if ($single > 0 && !in_array($single, $ids, true)) {
            $ids[] = $single;
        }
        if ($ids === []) {
            throw InventoryException::validation('A landed cost allocation must name the receipt it loads (metadata.target_document_ids[])');
        }

        return $ids;
    }

    /**
     * The FIRST receipt a LANDED_COST document loads.
     *
     * Kept for callers that only need one id and predate multi-receipt allocation. Anything that
     * allocates must use landedCostTargets(): reading only the first would silently drop every
     * charge belonging to the rest of the consignment.
     */
    public static function landedCostTarget(array $metadata): int
    {
        return self::landedCostTargets($metadata)[0];
    }

    /**
     * The charges a LANDED_COST document carries (metadata.charges), validated and normalised.
     *
     * A charge has no item and no quantity, so it cannot be a document line — normalizeLines()
     * requires an item_id on every one. It rides in metadata, which is where every other
     * line-less instruction on this type of document lives (challan settlements, job-work
     * settlements, the BOM of a production).
     *
     * @param array<string, mixed> $metadata
     * @return list<array{cost_type: string, amount: float, allocation_basis: string, description: ?string, books_acc_ref: ?int, lines: array<int, float>}>
     */
    public static function landedCostCharges(array $metadata): array
    {
        $raw = $metadata['charges'] ?? null;
        if (!is_array($raw) || $raw === []) {
            throw InventoryException::validation('A landed cost allocation must carry at least one charge (metadata.charges[])');
        }
        $out = [];
        foreach (array_values($raw) as $i => $entry) {
            $where = 'Charge ' . ($i + 1);
            if (!is_array($entry)) {
                throw InventoryException::validation($where . ': each charge must be an object with cost_type, amount and allocation_basis');
            }
            $part = self::landedCostPart($entry, $where);
            if ($part['amount'] <= 0) {
                throw InventoryException::validation($where . ': a ' . $part['cost_type'] . ' charge of zero allocates nothing; remove it or give it an amount');
            }
            $lines = [];
            $rawLines = $entry['lines'] ?? null;
            if (is_array($rawLines)) {
                foreach ($rawLines as $l) {
                    if (!is_array($l)) {
                        continue;
                    }
                    $lineId = (int) ($l['line_id'] ?? 0);
                    if ($lineId <= 0) {
                        throw InventoryException::validation($where . ': a per-line share must name the target line (line_id)');
                    }
                    $lines[$lineId] = round((float) ($l['amount'] ?? 0), 4) + ($lines[$lineId] ?? 0);
                }
            }
            if (in_array($part['allocation_basis'], ['manual', 'direct'], true) && $lines === []) {
                throw InventoryException::validation($where . ': a ' . $part['allocation_basis'] . ' charge must say which line carries it and how much (lines[{line_id, amount}])');
            }
            if ($part['allocation_basis'] === 'direct' && count($lines) !== 1) {
                throw InventoryException::validation($where . ': a direct charge belongs to exactly one line by nature, but ' . count($lines) . ' were named');
            }
            if ($lines !== []) {
                $sum = round(array_sum($lines), 4);
                if (abs($sum - $part['amount']) > 0.01) {
                    throw InventoryException::validation(
                        $where . ': the per-line shares sum to ' . number_format($sum, 4, '.', '') . ' but the charge is ' . number_format($part['amount'], 4, '.', ''),
                        ['lines_total' => $sum, 'amount' => $part['amount']],
                    );
                }
            }
            $out[] = $part + [
                'description'   => isset($entry['description']) ? substr((string) $entry['description'], 0, 255) : null,
                'books_acc_ref' => isset($entry['books_acc_ref']) && $entry['books_acc_ref'] ? (int) $entry['books_acc_ref'] : null,
                'lines'         => $lines,
            ];
        }

        return $out;
    }

    /** @return array<string, mixed> */
    private function headerFromPayload(int $cmpId, int $fyId, int $boId, string $type, array $p, string $sourceApp): array
    {
        $date = trim((string) ($p['document_date'] ?? $p['date'] ?? ''));
        if ($date === '' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            throw InventoryException::validation('document_date (YYYY-MM-DD) is required');
        }
        $h = [
            'cmp_id'               => $cmpId,
            'bo_id'                => $boId,
            'fy_id'                => $fyId,
            'document_type'        => $type,
            'document_no'          => isset($p['document_no']) ? substr(trim((string) $p['document_no']), 0, 64) : null,
            'series_id'            => isset($p['series_id']) && $p['series_id'] ? (int) $p['series_id'] : null,
            'document_date'        => $date,
            'source_app'           => $sourceApp,
            'source_document_type' => isset($p['source_document_type']) ? substr((string) $p['source_document_type'], 0, 48) : null,
            'source_document_id'   => isset($p['source_document_id']) && $p['source_document_id'] !== '' && $p['source_document_id'] !== null ? (int) $p['source_document_id'] : null,
            'source_document_uuid' => isset($p['source_document_uuid']) && $p['source_document_uuid'] ? (string) $p['source_document_uuid'] : null,
            'source_document_no'   => isset($p['source_document_no']) ? substr((string) $p['source_document_no'], 0, 64) : null,
            'source_document_date' => isset($p['source_document_date']) && preg_match('/^\d{4}-\d{2}-\d{2}/', (string) $p['source_document_date']) ? substr((string) $p['source_document_date'], 0, 10) : null,
            'party_ref'            => isset($p['party_ref']) && $p['party_ref'] ? (int) $p['party_ref'] : (isset($p['party']['acc_id']) && $p['party']['acc_id'] ? (int) $p['party']['acc_id'] : null),
            'party_name'           => isset($p['party_name']) ? substr((string) $p['party_name'], 0, 255) : (isset($p['party']['acc_name']) ? substr((string) $p['party']['acc_name'], 0, 255) : null),
            'dest_party_ref'       => isset($p['dest_party_ref']) && $p['dest_party_ref'] ? (int) $p['dest_party_ref'] : null,
            'from_warehouse_id'    => isset($p['from_warehouse_id']) && $p['from_warehouse_id'] ? (int) $p['from_warehouse_id'] : null,
            'to_warehouse_id'      => isset($p['to_warehouse_id']) && $p['to_warehouse_id'] ? (int) $p['to_warehouse_id'] : null,
            'dest_bo_id'           => isset($p['dest_bo_id']) && $p['dest_bo_id'] ? (int) $p['dest_bo_id'] : null,
            'stock_effect'         => isset($p['stock_effect']) && $p['stock_effect'] !== '' ? substr((string) $p['stock_effect'], 0, 32) : null,
            'returnable'           => isset($p['returnable']) ? (bool) $p['returnable'] : null,
            'expected_return_date' => isset($p['expected_return_date']) && preg_match('/^\d{4}-\d{2}-\d{2}/', (string) $p['expected_return_date']) ? substr((string) $p['expected_return_date'], 0, 10) : null,
            'movement_reason'      => isset($p['movement_reason']) ? substr((string) $p['movement_reason'], 0, 64) : null,
            'reason_code'          => isset($p['reason_code']) ? substr((string) $p['reason_code'], 0, 32) : null,
            'narration'            => isset($p['narration']) ? (string) $p['narration'] : null,
            'currency_code'        => isset($p['currency_code']) && $p['currency_code'] ? substr((string) $p['currency_code'], 0, 8) : 'INR',
            'exchange_rate'        => isset($p['exchange_rate']) && (float) $p['exchange_rate'] > 0 ? (float) $p['exchange_rate'] : 1,
            'metadata_json'        => isset($p['metadata']) && is_array($p['metadata']) ? json_encode($p['metadata'], JSON_UNESCAPED_UNICODE) : null,
            'idempotency_key'      => isset($p['idempotency_key']) ? substr((string) $p['idempotency_key'], 0, 128) : null,
        ];
        if ($type === 'STOCK_TRANSFER') {
            if (!$h['from_warehouse_id'] || !$h['to_warehouse_id']) {
                throw InventoryException::validation('Source and destination warehouses are required for a stock transfer');
            }
            if ($h['from_warehouse_id'] === $h['to_warehouse_id']) {
                throw InventoryException::validation('Source and destination warehouses must be different');
            }
        }
        if (in_array($type, ['DELIVERY_CHALLAN', 'INWARD_CHALLAN'], true) && $h['stock_effect'] === null) {
            $h['stock_effect'] = 'challan_only';
        }
        if (in_array($type, ['SALES_ISSUE', 'PURCHASE_RECEIPT', 'SALES_RETURN', 'PURCHASE_RETURN'], true) && $h['stock_effect'] === null) {
            $h['stock_effect'] = 'on_invoice';
        }
        if ($type === 'LANDED_COST') {
            // A draft that names no receipt and carries no charge is a document that cannot ever
            // post, saved as though it could. Posting checks both again from the stored metadata,
            // because the target's status can change between the draft being saved and posted.
            $meta = isset($p['metadata']) && is_array($p['metadata']) ? $p['metadata'] : [];
            self::landedCostTargets($meta);
            $charges = self::landedCostCharges($meta);
            // The capitalisation policy, asked of a charge that arrives on its own document. Asked
            // again at posting from the stored metadata (DocumentPostingService::applyLandedCost),
            // for the same reason the target's status is re-read there: a draft can outlive the
            // policy it was saved under, and posting is where the rupees actually reach stock.
            $capitalisable = $this->settings->capitalisableLandedCostTypes($cmpId);
            foreach ($charges as $i => $charge) {
                self::assertCostTypeCapitalisable((string) $charge['cost_type'], $capitalisable, 'Charge ' . ($i + 1));
            }
        }

        return $h;
    }

    /**
     * Normalise the lines of a payload into storable rows (entered unit + base unit + direction).
     *
     * @return list<array<string, mixed>>
     */
    private function normalizeLines(int $cmpId, string $type, array $spec, array $p, array $header): array
    {
        $raw = $p['lines'] ?? $p['inventory_lines'] ?? $p['packing_lines'] ?? $p['job_work_lines'] ?? [];
        if (!is_array($raw)) {
            $raw = [];
        }
        $this->units->warmCompany($cmpId);
        // Resolved at most once per payload, and only if some line actually carries a landed cost:
        // the great majority of documents carry none, and this runs on every create and every
        // update of every type.
        $capitalisable = null;
        $db = \Config\Database::connect();
        $out = [];
        $sort = 0;
        foreach ($raw as $idx => $line) {
            if (!is_array($line)) {
                continue;
            }
            $itemId = (int) ($line['item_id'] ?? 0);
            $qty = (float) ($line['qty'] ?? 0);
            if ($itemId <= 0) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': item_id is required');
            }
            $countDirection = null;
            if ($type === 'PHYSICAL_ADJUSTMENT' && $qty <= 0 && isset($line['book_qty'], $line['physical_qty']) && $line['book_qty'] !== '' && $line['physical_qty'] !== '') {
                $diff = round((float) $line['physical_qty'] - (float) $line['book_qty'], 4);
                if (abs($diff) < 0.0001) {
                    continue; // counted equal to book: nothing to adjust
                }
                $qty = abs($diff);
                $countDirection = $diff > 0 ? 'in' : 'out';
            }
            if ($qty <= 0) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': qty must be greater than zero');
            }
            $item = $db->table('inv_items')->select('item_id, unit_id, item_type, is_active, deleted_at')->where('cmp_id', $cmpId)->where('item_id', $itemId)->get()->getRowArray();
            if (!$item) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': item #' . $itemId . ' not found in this company', ['item_id' => $itemId]);
            }
            if ($item['deleted_at'] !== null) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': item #' . $itemId . ' is deleted', ['item_id' => $itemId]);
            }
            $explicitUnitId = isset($line['unit_id']) && (int) $line['unit_id'] > 0 ? (int) $line['unit_id'] : null;
            // A unit_id the line actually named must be one this item is registered under --
            // otherwise UnitConversionService::factorFor() cannot tell "this unit legitimately
            // converts 1:1" from "this unit was never configured for this item at all" and would
            // silently fall back to a factor of 1.0, posting the line's qty/rate at whatever scale
            // the caller happened to supply. That is how a line entered in Kilograms against an
            // item priced in Grams (with no Kilograms alternate unit registered) posts through at
            // a ~1000x scale error with no warning -- confirmed against real production data.
            if ($explicitUnitId !== null && !$this->units->isRegisteredUnit($cmpId, $itemId, $explicitUnitId)) {
                throw InventoryException::validation(
                    'Line ' . ($idx + 1) . ': unit #' . $explicitUnitId . ' is not a registered unit for item #' . $itemId . ' -- add it as an alternate unit with a real conversion factor before posting in this unit',
                    ['item_id' => $itemId, 'unit_id' => $explicitUnitId]
                );
            }
            $unitId = $explicitUnitId ?? ($this->units->defaultUnitId($cmpId, $itemId) ?: (int) ($item['unit_id'] ?? 0));
            $factor = $this->units->factorFor($cmpId, $itemId, $unitId > 0 ? $unitId : null);
            $rate = (float) ($line['rate'] ?? $line['source_transaction_rate'] ?? 0);
            $amount = (float) ($line['amount'] ?? $line['source_transaction_amount'] ?? 0);
            if ($amount <= 0 && $rate > 0) {
                $amount = round($qty * $rate, 4);
            }
            $wh = isset($line['warehouse_id']) && $line['warehouse_id'] ? (int) $line['warehouse_id'] : (isset($line['mc_id']) && $line['mc_id'] ? (int) $line['mc_id'] : null);
            $base = [
                'item_id'                   => $itemId,
                'warehouse_id'              => $wh,
                'location_id'               => isset($line['location_id']) && $line['location_id'] ? (int) $line['location_id'] : null,
                'batch_id'                  => isset($line['batch_id']) && $line['batch_id'] ? (int) $line['batch_id'] : null,
                'unit_id'                   => $unitId > 0 ? $unitId : null,
                'qty'                       => round($qty, 4),
                'conversion_factor'         => $factor,
                'base_qty'                  => UnitConversionService::toBaseQty($qty, $factor),
                'source_transaction_rate'   => $rate > 0 ? round($rate, 4) : null,
                'source_transaction_amount' => $amount > 0 ? round($amount, 4) : null,
                'source_fc_rate'            => isset($line['fc_rate']) ? (float) $line['fc_rate'] : null,
                'source_fc_amount'          => isset($line['fc_amount']) ? (float) $line['fc_amount'] : null,
                'source_exchange_rate'      => isset($line['exchange_rate']) ? (float) $line['exchange_rate'] : null,
                'valuation_rate'            => isset($line['valuation_rate']) && $line['valuation_rate'] !== '' && $line['valuation_rate'] !== null ? (float) $line['valuation_rate'] : null,
                'book_qty'                  => isset($line['book_qty']) && $line['book_qty'] !== '' ? (float) $line['book_qty'] : null,
                'physical_qty'              => isset($line['physical_qty']) && $line['physical_qty'] !== '' ? (float) $line['physical_qty'] : null,
                'books_tax_cat_id'          => isset($line['tax_cat_id']) && $line['tax_cat_id'] ? (int) $line['tax_cat_id'] : (isset($line['books_tax_cat_id']) && $line['books_tax_cat_id'] ? (int) $line['books_tax_cat_id'] : null),
                'hsn_sac'                   => isset($line['hsn_sac']) ? substr((string) $line['hsn_sac'], 0, 16) : null,
                'source_line_ref'           => isset($line['source_line_ref']) && $line['source_line_ref'] ? (int) $line['source_line_ref'] : null,
                'description'               => isset($line['description']) ? substr((string) $line['description'], 0, 512) : null,
                'metadata_json'             => isset($line['metadata']) && is_array($line['metadata']) ? json_encode($line['metadata'], JSON_UNESCAPED_UNICODE) : null,
                'serials'                   => isset($line['serials']) && is_array($line['serials']) ? $line['serials'] : [],
            ];

            // Landed cost: the rupee amount Books allocated to this line, plus the breakdown of
            // which charges make it up. The breakdown has no column of its own and rides in the
            // line's metadata, because posting reads its lines back out of the database and would
            // otherwise lose the detail between create and post.
            $landed = self::landedCostFromLine($line, (int) $idx + 1);
            // Intake point one for the company's capitalisation policy: the breakdown that arrives
            // on the receipt itself. Asked here, per line, before anything is stored — and asked of
            // the STORED line too, because update() runs normalizeLines() over the rows it read
            // back, so a draft saved before a type was switched off is refused when it is next
            // touched rather than posted under a policy that no longer allows it.
            if ($landed['amount'] > 0 || $landed['breakdown'] !== []) {
                $capitalisable ??= $this->settings->capitalisableLandedCostTypes($cmpId);
                self::assertLandedCostPolicy($landed['amount'], $landed['breakdown'], $capitalisable, 'Line ' . ((int) $idx + 1));
            }
            $base['landed_cost_amount'] = $landed['amount'];
            if ($landed['breakdown'] !== []) {
                $lineMeta = isset($line['metadata']) && is_array($line['metadata']) ? $line['metadata'] : [];
                $lineMeta['landed_cost_breakdown'] = $landed['breakdown'];
                $base['metadata_json'] = json_encode($lineMeta, JSON_UNESCAPED_UNICODE);
            }

            $emittedFrom = count($out);
            switch ($spec['line_mode']) {
                case 'fixed_in':
                    $base['direction'] = 'in';
                    $out[] = $base + ['sort_order' => $sort++];
                    break;
                case 'fixed_out':
                    $base['direction'] = 'out';
                    $out[] = $base + ['sort_order' => $sort++];
                    break;
                case 'transfer':
                    $from = isset($line['from_warehouse_id']) && $line['from_warehouse_id'] ? (int) $line['from_warehouse_id'] : (int) $header['from_warehouse_id'];
                    $to = $wh ?: (int) $header['to_warehouse_id'];
                    if ($from === $to) {
                        throw InventoryException::validation('Line ' . ($idx + 1) . ': source and destination warehouses must differ');
                    }
                    $pairKey = 'tp-' . $idx;
                    $out[] = array_merge($base, ['direction' => 'out', 'warehouse_id' => $from, 'dest_warehouse_id' => $to, 'sort_order' => $sort++, 'metadata_json' => json_encode(['transfer_pair' => $pairKey, 'side' => 'out'])]);
                    $out[] = array_merge($base, ['direction' => 'in', 'warehouse_id' => $to, 'dest_warehouse_id' => null, 'sort_order' => $sort++, 'metadata_json' => json_encode(['transfer_pair' => $pairKey, 'side' => 'in'])]);
                    break;
                case 'by_line':
                    $dir = strtolower(trim((string) ($line['direction'] ?? '')));
                    if ($dir === '' && isset($line['dr_cr'])) {
                        $dir = (int) $line['dr_cr'] === 1 ? 'in' : 'out';
                    }
                    if ($dir === '' && $countDirection !== null) {
                        $dir = $countDirection;
                    }
                    if (!in_array($dir, ['in', 'out'], true)) {
                        throw InventoryException::validation('Line ' . ($idx + 1) . ': direction (in|out) is required for ' . $type);
                    }
                    $base['direction'] = $dir;
                    $out[] = $base + ['sort_order' => $sort++];
                    break;
                case 'status_only':
                case 'pending_only':
                default:
                    $base['direction'] = in_array($type, ['DELIVERY_CHALLAN', 'JOB_WORK_OUT', 'PACKING', 'RESERVATION'], true) ? 'out' : (in_array($type, ['INWARD_CHALLAN', 'RESERVATION_RELEASE'], true) ? 'in' : 'none');
                    $out[] = $base + ['sort_order' => $sort++];
                    break;
            }

            // Per EMITTED row, so the out leg a transfer generates from one entered line is caught
            // as well as the line the user typed.
            for ($r = $emittedFrom, $n = count($out); $r < $n; $r++) {
                self::assertLandedCostAllowed($type, $spec, (string) ($header['stock_effect'] ?? ''), (string) ($out[$r]['direction'] ?? ''), (float) ($out[$r]['landed_cost_amount'] ?? 0), (int) $idx + 1);
            }
        }

        return $out;
    }

    /** @param list<array<string, mixed>> $lines */
    private function writeLines($db, int $documentId, int $cmpId, int $fyId, int $boId, array $lines): void
    {
        foreach ($lines as $line) {
            $serials = $line['serials'] ?? [];
            unset($line['serials']);
            $row = array_merge($line, ['document_id' => $documentId, 'cmp_id' => $cmpId, 'fy_id' => $fyId, 'bo_id' => $boId]);
            DatabaseInsertHelper::insert($db, 'inv_document_lines', $row);
            $lineId = (int) $db->insertID();
            foreach ($serials as $s) {
                $serialId = is_array($s) ? (int) ($s['serial_id'] ?? 0) : (int) $s;
                if ($serialId > 0) {
                    $db->table('inv_document_line_serials')->insert(['line_id' => $lineId, 'document_id' => $documentId, 'cmp_id' => $cmpId, 'serial_id' => $serialId]);
                }
            }
        }
    }

    private function transition(int $cmpId, int $documentId, array $from, string $to, string $action, ?string $actor, ?string $notes): array
    {
        $doc = $this->get($cmpId, $documentId);
        if (!in_array($doc['status'], $from, true)) {
            throw InventoryException::invalidState('Cannot ' . $action . ' a document in status ' . $doc['status']);
        }
        $db = \Config\Database::connect();
        $db->table('inv_documents')->where('document_id', $documentId)->update(['status' => $to, 'updated_by' => $actor, 'updated_at' => date('Y-m-d H:i:s')]);
        $db->table('inv_document_approvals')->insert(['cmp_id' => $cmpId, 'document_id' => $documentId, 'action' => $action, 'actor_uuid' => $actor, 'notes' => $notes, 'created_at' => date('Y-m-d H:i:s')]);
        $this->audit->log($cmpId, 'document', $documentId, 'document.' . $action, $actor, ['reason' => $notes], ['status' => $doc['status']], ['status' => $to]);

        return $this->get($cmpId, $documentId);
    }
}
