<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Exceptions\InventoryException;
use App\Services\AuditService;
use App\Services\SchemaCache;

/**
 * /api/v1/serials — inv_serials. Unique per (cmp, item, serial_no).
 * Serials created through the master are 'expected' until a receipt document moves them
 * to in_stock; bulkCreate registers many expected serials in one call.
 * No soft delete: delete is physical and guarded by document references / stock-bearing status.
 * Permission base: masters.serials.
 *
 * Beyond CRUD this controller answers the three further questions the serial
 * workspace asks: `summary` (the counters, over the SAME filters the list is
 * showing), `history` (one serial's audit trail and the documents that touched
 * it) and `bulkUpdate` (a location / warranty correction across a selection).
 * Status is deliberately NOT bulk-editable: a stock-bearing status is the
 * posting engine's to set, and a screen that could set it by hand would be a
 * way around every document the engine writes.
 */
class SerialsController extends BaseController
{
    private const PERM = 'masters.serials';

    /**
     * Who may read a serial's money.
     *
     * Unit cost is stock valuation, not a master-data attribute, so it is gated
     * on the permission that already means "may see what stock is worth" rather
     * than on a new key nobody's stored profile carries yet. Every system
     * profile template grants every `.read` key, so this changes nothing for
     * them; a hand-built profile that deliberately withholds the valuation
     * report now withholds the cost column too, which is what withholding it
     * was always supposed to mean. The column is dropped from the ROW, not
     * hidden by the client — there is nothing in the payload to reveal.
     */
    private const COST_PERM = 'reports.valuation.read';

    public const STATUSES = ['expected', 'in_stock', 'reserved', 'issued', 'in_transit', 'damaged', 'returned', 'scrapped'];

    /** Statuses that mean the serial is physically held by the company (deletion via a serial adjustment instead). */
    private const STOCK_BEARING = ['in_stock', 'reserved', 'in_transit'];

    /**
     * The three buckets the workspace counts in — a partition of STATUSES.
     *
     * A partition on purpose: the three cards sit beside a "Total" card, and
     * three figures that do not add up to the fourth are the first thing a
     * stock controller notices and the last thing they forgive.
     */
    public const STATUS_GROUPS = [
        'in_stock'  => ['in_stock'],
        'allocated' => ['expected', 'reserved', 'in_transit'],
        'out'       => ['issued', 'returned', 'damaged', 'scrapped'],
    ];

    private const BULK_MAX = 5000;
    private const BULK_UPDATE_MAX = 500;

    /**
     * Warranty windows in days.
     *
     * Sent with every summary so the browser never invents a threshold: the
     * figure and the rule that produced it travel together, and a tenant
     * setting can later change both in one place.
     */
    private const WARRANTY_SOON_DAYS = 30;
    private const WARRANTY_UPCOMING_DAYS = 90;

    private const COLUMNS = ['serial_no', 'batch_id', 'warehouse_id', 'location_id', 'status', 'unit_cost', 'warranty_until'];
    private const SORT = [
        'serial_no'      => 's.serial_no',
        'serial_id'      => 's.serial_id',
        'status'         => 's.status',
        'item_name'      => 'i.item_name',
        'item_sku'       => 'i.item_sku',
        'warehouse_name' => 'w.warehouse_name',
        'batch_no'       => 'b.batch_no',
        'location_code'  => 'l.location_code',
        'unit_cost'      => 's.unit_cost',
        'warranty_until' => 's.warranty_until',
        'created_at'     => 's.created_at',
        'updated_at'     => 's.updated_at',
    ];
    private const SELECT = 's.serial_id, s.serial_uuid, s.item_id, s.serial_no, s.batch_id, s.warehouse_id, s.location_id, s.status, s.unit_cost, s.received_document_id, s.issued_document_id, s.warranty_until, s.attributes_json, s.created_at, s.created_by, s.updated_at, s.updated_by, i.item_name, i.item_sku, i.item_upc, i.item_grp_id, i.brand_id, i.stock_cat_id, w.warehouse_name, w.warehouse_code, b.batch_no, b.expiry_date, l.location_code, l.location_name';

    public function index()
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $costVisible = $this->mayReadCost($a);
        $p = $this->listParams(100, 1000, 'serial_no');
        $b = $this->applyFilters($this->baseQuery($cmpId));
        $total = (clone $b)->countAllResults(false);
        $rows = $b->select(self::SELECT)->orderBy(self::SORT[$p['sort']] ?? 's.serial_no', $p['order'])->limit($p['limit'], $p['offset'])->get()->getResultArray();

        // Alongside the rows: whether this reader may see money at all, and the
        // symbol the figures are in. Both travel with the page they describe,
        // so the table never formats one company's costs with another's symbol
        // while a second request is in flight.
        return $this->respondList(
            array_map(fn (array $row): array => $this->present($row, $costVisible), $rows),
            $total,
            $p['limit'],
            $p['offset'],
            ['cost_visible' => $costVisible, 'currency' => $this->baseCurrency($cmpId)],
        );
    }

    /**
     * GET /serials/summary — the counters above the list, over the SAME filters.
     *
     * Counted by the server across the whole filtered set, never derived in the
     * browser from the page on screen: a card that said 892 because that is how
     * many of the 100 rows on screen were in stock would be worse than no card.
     *
     * `previous_total` is the honest one. Status has no history in this schema —
     * a serial that is `issued` today was never recorded as `in_stock`
     * yesterday — so only the TOTAL can carry a real month-on-month delta, and
     * it is counted from `created_at`. The other three send no comparative at
     * all rather than a made-up one, and the UI draws no delta chip for them.
     */
    public function summary()
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];

        try {
            return $this->respond(['data' => $this->summaryFor($cmpId, $this->mayReadCost($a))]);
        } catch (\Throwable $e) {
            log_message('error', 'serials summary failed: ' . $e->getMessage());

            return $this->failStructured(500, 'query_failed', 'Could not count the serial numbers for this company');
        }
    }

    /**
     * The counters themselves, separated from the authorisation around them so
     * an integration test can drive this SQL against a real PostgreSQL.
     *
     * @return array<string, mixed>
     */
    private function summaryFor(int $cmpId, bool $costVisible): array
    {
        $today = date('Y-m-d');
        $soon = date('Y-m-d', strtotime($today . ' +' . self::WARRANTY_SOON_DAYS . ' days'));
        $upcoming = date('Y-m-d', strtotime($today . ' +' . self::WARRANTY_UPCOMING_DAYS . ' days'));
        $previousAsOf = date('Y-m-d', strtotime($today . ' -1 month'));

        $filtered = fn () => $this->applyFilters($this->baseQuery($cmpId));

        $byStatus = array_fill_keys(self::STATUSES, 0);
        foreach ($filtered()->select('s.status, COUNT(*) AS n')->groupBy('s.status')->get()->getResultArray() as $row) {
            $byStatus[(string) $row['status']] = (int) $row['n'];
        }
        $total = array_sum($byStatus);

        $groups = [];
        foreach (self::STATUS_GROUPS as $group => $statuses) {
            $groups[$group] = array_sum(array_map(static fn (string $s): int => $byStatus[$s] ?? 0, $statuses));
        }

        $warranty = [
            'expired'  => (clone $filtered())->where('s.warranty_until IS NOT NULL', null, false)->where('s.warranty_until <', $today)->countAllResults(),
            'soon'     => (clone $filtered())->where('s.warranty_until >=', $today)->where('s.warranty_until <=', $soon)->countAllResults(),
            'upcoming' => (clone $filtered())->where('s.warranty_until >', $soon)->where('s.warranty_until <=', $upcoming)->countAllResults(),
            'active'   => (clone $filtered())->where('s.warranty_until >', $upcoming)->countAllResults(),
            'none'     => (clone $filtered())->where('s.warranty_until', null)->countAllResults(),
            'soon_days'     => self::WARRANTY_SOON_DAYS,
            'upcoming_days' => self::WARRANTY_UPCOMING_DAYS,
        ];

        $previousTotal = (clone $filtered())->where('s.created_at <', $previousAsOf . ' 00:00:00')->countAllResults();

        // Only over serials the company still physically holds, and only for
        // a reader allowed to see stock money at all.
        $inStockValue = null;
        if ($costVisible) {
            $row = $filtered()->select('COALESCE(SUM(s.unit_cost), 0) AS v')->whereIn('s.status', self::STATUS_GROUPS['in_stock'])->get()->getRowArray();
            $inStockValue = round((float) ($row['v'] ?? 0), 4);
        }

        // Serials the workspace cannot place: registered, still held, no
        // warehouse on them. The one finding here that is a data-quality
        // problem rather than a count, so it is counted with the rest.
        $unplaced = $filtered()->where('s.warehouse_id', null)->whereIn('s.status', array_merge(self::STATUS_GROUPS['in_stock'], self::STATUS_GROUPS['allocated']))->countAllResults();

        return [
            'as_on'          => $today,
            'currency'       => $this->baseCurrency($cmpId),
            'cost_visible'   => $costVisible,
            'total'          => $total,
            'previous_total' => $previousTotal,
            'previous_as_of' => $previousAsOf,
            'by_status'      => $byStatus,
            'groups'         => $groups,
            'warranty'       => $warranty,
            'in_stock_value' => $inStockValue,
            'unplaced'       => $unplaced,
        ];
    }

    public function show($id = null)
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $row = $this->fetch((int) $a['ctx']['cmp_id'], (int) $id, $this->mayReadCost($a));

        return $row ? $this->respond(['data' => $row]) : $this->failStructured(404, 'not_found', 'Serial not found');
    }

    /**
     * GET /serials/{id}/history — what happened to this serial, oldest first.
     *
     * Two sources, merged and left labelled: the audit trail (who changed what,
     * with before / after) and the document lines that carry the serial (what
     * the business did with it). Neither is invented here and nothing is copied
     * into a second table — the lifecycle is a READ across records that already
     * exist, which is why a serial's story survives a screen being rewritten.
     */
    public function history($id = null)
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $serialId = (int) $id;
        $serial = $this->fetch($cmpId, $serialId, $this->mayReadCost($a));
        if (!$serial) {
            return $this->failStructured(404, 'not_found', 'Serial not found');
        }

        return $this->respond(['data' => ['serial' => $serial, 'events' => $this->historyEvents($cmpId, $serialId)]]);
    }

    /**
     * The two streams behind the lifecycle, merged and ordered.
     *
     * Separated from the action for the same reason as `summaryFor()`: this is
     * the part with SQL in it, and a test has to be able to run it.
     *
     * @return list<array<string, mixed>>
     */
    private function historyEvents(int $cmpId, int $serialId): array
    {
        $db = \Config\Database::connect();
        $events = [];

        if (SchemaCache::tableExists($db, 'inv_audit_log')) {
            $rows = $db->table('inv_audit_log')
                ->select('audit_id, action, actor_uuid, source_app, source_document_type, source_document_id, reason, before_json, after_json, created_at')
                ->where('cmp_id', $cmpId)
                ->where('entity_type', 'serial')
                ->where('entity_id', $serialId)
                ->orderBy('created_at', 'ASC')
                ->orderBy('audit_id', 'ASC')
                ->limit(200)
                ->get()
                ->getResultArray();
            foreach ($rows as $row) {
                $events[] = [
                    'kind'       => 'audit',
                    'ref_id'     => (int) $row['audit_id'],
                    'at'         => $row['created_at'],
                    'action'     => $row['action'],
                    'actor_uuid' => $row['actor_uuid'],
                    'source_app' => $row['source_app'],
                    'reason'     => $row['reason'],
                    'before'     => $this->decodeJson($row['before_json'] ?? null),
                    'after'      => $this->decodeJson($row['after_json'] ?? null),
                ];
            }
        }

        if (SchemaCache::tableExists($db, 'inv_document_line_serials')) {
            $rows = $db->table('inv_document_line_serials ds')
                ->select('d.document_id, d.document_no, d.document_type, d.document_date, d.status, d.created_at, dl.direction, dl.qty, dl.warehouse_id, dl.dest_warehouse_id, w.warehouse_name, dw.warehouse_name AS dest_warehouse_name, l.location_code')
                ->join('inv_documents d', 'd.document_id = ds.document_id', 'inner')
                ->join('inv_document_lines dl', 'dl.line_id = ds.line_id', 'left')
                ->join('inv_warehouses w', 'w.warehouse_id = dl.warehouse_id', 'left')
                ->join('inv_warehouses dw', 'dw.warehouse_id = dl.dest_warehouse_id', 'left')
                ->join('inv_locations l', 'l.location_id = dl.location_id', 'left')
                ->where('ds.cmp_id', $cmpId)
                ->where('ds.serial_id', $serialId)
                ->orderBy('d.document_date', 'ASC')
                ->orderBy('d.document_id', 'ASC')
                ->limit(200)
                ->get()
                ->getResultArray();
            foreach ($rows as $row) {
                $events[] = [
                    'kind'                => 'document',
                    'ref_id'              => (int) $row['document_id'],
                    'at'                  => $row['document_date'],
                    'recorded_at'         => $row['created_at'] ?? null,
                    'document_id'         => (int) $row['document_id'],
                    'document_no'         => $row['document_no'],
                    'document_type'       => $row['document_type'],
                    'document_status'     => $row['status'],
                    'direction'           => $row['direction'],
                    'qty'                 => $row['qty'] === null ? null : (float) $row['qty'],
                    'warehouse_name'      => $row['warehouse_name'],
                    'dest_warehouse_name' => $row['dest_warehouse_name'],
                    'location_code'       => $row['location_code'],
                ];
            }
        }

        usort($events, static function (array $x, array $y): int {
            $ax = (string) ($x['at'] ?? '');
            $ay = (string) ($y['at'] ?? '');

            return $ax === $ay ? ((int) ($x['ref_id'] ?? 0) <=> (int) ($y['ref_id'] ?? 0)) : strcmp($ax, $ay);
        });

        return $events;
    }

    public function create()
    {
        $a = $this->authorize(self::PERM . '.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        try {
            $row = $this->buildRow($cmpId, $body, null);
            $now = date('Y-m-d H:i:s');
            $row += ['cmp_id' => $cmpId, 'created_by' => $a['session']['uuid'], 'created_at' => $now, 'updated_by' => $a['session']['uuid'], 'updated_at' => $now];
            $db = \Config\Database::connect();
            $db->table('inv_serials')->insert($row);
            $id = (int) $db->insertID();
            (new AuditService())->log($cmpId, 'serial', $id, 'serial.create', $a['session']['uuid'], [], null, $row);

            return $this->respondCreated(['data' => $this->fetch($cmpId, $id, $this->mayReadCost($a))]);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    public function update($id = null)
    {
        $a = $this->authorize(self::PERM . '.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $db = \Config\Database::connect();
        $existing = $db->table('inv_serials')->where('cmp_id', $cmpId)->where('serial_id', (int) $id)->get()->getRowArray();
        if (!$existing) {
            return $this->failStructured(404, 'not_found', 'Serial not found');
        }
        $body = $this->request->getJSON(true) ?? [];
        try {
            $row = $this->buildRow($cmpId, array_merge($existing, $body), $existing);
            $row['updated_by'] = $a['session']['uuid'];
            $row['updated_at'] = date('Y-m-d H:i:s');
            $db->table('inv_serials')->where('serial_id', (int) $id)->where('cmp_id', $cmpId)->update($row);
            (new AuditService())->log($cmpId, 'serial', (int) $id, 'serial.update', $a['session']['uuid'], [], $existing, $row);

            return $this->respond(['data' => $this->fetch($cmpId, (int) $id, $this->mayReadCost($a))]);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    public function delete($id = null)
    {
        $a = $this->authorize(self::PERM . '.delete', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $db = \Config\Database::connect();
        $existing = $db->table('inv_serials')->where('cmp_id', $cmpId)->where('serial_id', (int) $id)->get()->getRowArray();
        if (!$existing) {
            return $this->failStructured(404, 'not_found', 'Serial not found');
        }
        $n = $db->table('inv_document_line_serials')->where('cmp_id', $cmpId)->where('serial_id', (int) $id)->countAllResults();
        if ($n > 0) {
            return $this->failStructured(409, 'delete_blocked', 'Serial is referenced by ' . $n . ' document line(s) and cannot be deleted', ['guard' => 'document line(s)', 'count' => $n]);
        }
        if (in_array((string) $existing['status'], self::STOCK_BEARING, true)) {
            return $this->failStructured(409, 'delete_blocked', 'Serial is ' . $existing['status'] . '; remove it with a serial adjustment document instead', ['guard' => 'status', 'status' => $existing['status']]);
        }
        $db->table('inv_serials')->where('cmp_id', $cmpId)->where('serial_id', (int) $id)->delete();
        (new AuditService())->log($cmpId, 'serial', (int) $id, 'serial.delete', $a['session']['uuid'], [], $existing, null);

        return $this->respondDeleted(['data' => ['serial_id' => (int) $id]]);
    }

    /**
     * POST /serials/bulk {item_id, serial_nos:[...], warehouse_id?, batch_id?, location_id?}
     * Registers 'expected' serials. Duplicates (in the request or already registered) are skipped, not errors.
     */
    public function bulkCreate()
    {
        $a = $this->authorize(self::PERM . '.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        $db = \Config\Database::connect();
        try {
            $itemId = (int) ($body['item_id'] ?? 0);
            $item = $this->requireSerialItem($cmpId, $itemId);
            $warehouseId = isset($body['warehouse_id']) && (int) $body['warehouse_id'] > 0 ? (int) $body['warehouse_id'] : null;
            $batchId = isset($body['batch_id']) && (int) $body['batch_id'] > 0 ? (int) $body['batch_id'] : null;
            $locationId = isset($body['location_id']) && (int) $body['location_id'] > 0 ? (int) $body['location_id'] : null;
            $this->validateRefs($cmpId, $itemId, $warehouseId, $batchId, $locationId);
            $warrantyUntil = trim((string) ($body['warranty_until'] ?? ''));
            if ($warrantyUntil !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $warrantyUntil)) {
                throw InventoryException::validation('warranty_until must be YYYY-MM-DD', ['field' => 'warranty_until']);
            }
            $raw = $body['serial_nos'] ?? [];
            if (!is_array($raw) || $raw === []) {
                throw InventoryException::validation('serial_nos must be a non-empty list', ['field' => 'serial_nos']);
            }
            if (count($raw) > self::BULK_MAX) {
                throw InventoryException::validation('At most ' . self::BULK_MAX . ' serial numbers per request', ['field' => 'serial_nos', 'max' => self::BULK_MAX]);
            }
            $skipped = [];
            $wanted = [];
            foreach ($raw as $s) {
                // A row may be a bare string or an object. The object form
                // carries the one field that genuinely differs per unit: an
                // imported CSV of serials received on different days has a
                // warranty date a row, and forcing one date on the whole file
                // would be the import quietly inventing data.
                $no = is_array($s) ? trim((string) ($s['serial_no'] ?? '')) : trim((string) $s);
                $rowWarranty = is_array($s) ? trim((string) ($s['warranty_until'] ?? '')) : '';
                if ($no === '') {
                    $skipped[] = ['serial_no' => $no, 'reason' => 'empty'];
                    continue;
                }
                if (strlen($no) > 128) {
                    $skipped[] = ['serial_no' => $no, 'reason' => 'too_long'];
                    continue;
                }
                if ($rowWarranty !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $rowWarranty)) {
                    $skipped[] = ['serial_no' => $no, 'reason' => 'bad_warranty'];
                    continue;
                }
                if (isset($wanted[$no])) {
                    $skipped[] = ['serial_no' => $no, 'reason' => 'duplicate_in_request'];
                    continue;
                }
                $wanted[$no] = $rowWarranty !== '' ? $rowWarranty : ($warrantyUntil !== '' ? $warrantyUntil : null);
            }
            $existing = [];
            foreach (array_chunk(array_keys($wanted), 500) as $chunk) {
                foreach ($db->table('inv_serials')->select('serial_no, status')->where('cmp_id', $cmpId)->where('item_id', $itemId)->whereIn('serial_no', $chunk)->get()->getResultArray() as $r) {
                    $existing[$r['serial_no']] = $r['status'];
                }
            }
            $now = date('Y-m-d H:i:s');
            $rows = [];
            foreach ($wanted as $no => $rowWarranty) {
                $no = (string) $no;
                if (isset($existing[$no])) {
                    $skipped[] = ['serial_no' => $no, 'reason' => 'already_registered', 'status' => $existing[$no]];
                    continue;
                }
                $rows[] = ['cmp_id' => $cmpId, 'item_id' => $itemId, 'serial_no' => $no, 'batch_id' => $batchId, 'warehouse_id' => $warehouseId, 'location_id' => $locationId, 'status' => 'expected', 'warranty_until' => $rowWarranty, 'created_by' => $a['session']['uuid'], 'created_at' => $now, 'updated_by' => $a['session']['uuid'], 'updated_at' => $now];
            }
            $created = [];
            if ($rows !== []) {
                $db->transStart();
                foreach (array_chunk($rows, 500) as $chunk) {
                    $db->table('inv_serials')->insertBatch($chunk);
                    $nos = array_column($chunk, 'serial_no');
                    foreach ($db->table('inv_serials')->select('serial_id, serial_no')->where('cmp_id', $cmpId)->where('item_id', $itemId)->whereIn('serial_no', $nos)->get()->getResultArray() as $r) {
                        $created[] = ['serial_id' => (int) $r['serial_id'], 'serial_no' => $r['serial_no']];
                    }
                }
                $db->transComplete();
                if ($db->transStatus() === false) {
                    throw new \RuntimeException('Could not register serial numbers', 500);
                }
                (new AuditService())->log($cmpId, 'serial', $itemId, 'serial.bulk_create', $a['session']['uuid'], [], null, ['item_id' => $itemId, 'warehouse_id' => $warehouseId, 'batch_id' => $batchId, 'created' => count($created), 'skipped' => count($skipped)]);
            }

            return $this->respondCreated(['data' => ['item_id' => $itemId, 'item_name' => $item['item_name'], 'created' => $created, 'skipped' => $skipped, 'created_count' => count($created), 'skipped_count' => count($skipped)]]);
        } catch (\Throwable $e) {
            $db->transRollback();

            return $this->failFromException($e);
        }
    }

    /**
     * POST /serials/bulk-update {serial_ids:[...], warehouse_id?, location_id?, batch_id?, warranty_until?}
     *
     * A correction across a selection: where the serials are and how long they
     * are covered. `null` clears a field; a key that is absent is left alone,
     * so "set the location" does not silently wipe the batch.
     *
     * What it will NOT do is move stock. Status stays out of the body entirely:
     * `in_stock` is a claim that a receipt was posted, and a bulk editor that
     * could assert it would be a way around the posting engine and the ledger
     * it writes. Per-row failures are REPORTED, never swallowed — the caller
     * gets the reason for each one and the rest still go through.
     */
    public function bulkUpdate()
    {
        $a = $this->authorize(self::PERM . '.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        $db = \Config\Database::connect();

        try {
            $ids = array_values(array_unique(array_filter(array_map('intval', (array) ($body['serial_ids'] ?? [])), static fn (int $n): bool => $n > 0)));
            if ($ids === []) {
                throw InventoryException::validation('serial_ids must be a non-empty list', ['field' => 'serial_ids']);
            }
            if (count($ids) > self::BULK_UPDATE_MAX) {
                throw InventoryException::validation('At most ' . self::BULK_UPDATE_MAX . ' serial numbers per request', ['field' => 'serial_ids', 'max' => self::BULK_UPDATE_MAX]);
            }

            $patch = [];
            foreach (['warehouse_id', 'location_id', 'batch_id'] as $ref) {
                if (array_key_exists($ref, $body)) {
                    $patch[$ref] = (int) $body[$ref] > 0 ? (int) $body[$ref] : null;
                }
            }
            if (array_key_exists('warranty_until', $body)) {
                $w = trim((string) ($body['warranty_until'] ?? ''));
                if ($w !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $w)) {
                    throw InventoryException::validation('warranty_until must be YYYY-MM-DD', ['field' => 'warranty_until']);
                }
                $patch['warranty_until'] = $w !== '' ? $w : null;
            }
            if ($patch === []) {
                throw InventoryException::validation('Nothing to change: send warehouse_id, location_id, batch_id or warranty_until', ['field' => 'patch']);
            }

            $existing = [];
            foreach (array_chunk($ids, 200) as $chunk) {
                foreach ($db->table('inv_serials')->where('cmp_id', $cmpId)->whereIn('serial_id', $chunk)->get()->getResultArray() as $row) {
                    $existing[(int) $row['serial_id']] = $row;
                }
            }

            $now = date('Y-m-d H:i:s');
            $audit = new AuditService();
            $updated = [];
            $failed = [];
            foreach ($ids as $id) {
                $row = $existing[$id] ?? null;
                if (!$row) {
                    $failed[] = ['serial_id' => $id, 'serial_no' => null, 'reason' => 'not_found'];
                    continue;
                }
                $next = array_merge($row, $patch);
                try {
                    $this->validateRefs(
                        $cmpId,
                        (int) $row['item_id'],
                        $next['warehouse_id'] === null ? null : (int) $next['warehouse_id'],
                        $next['batch_id'] === null ? null : (int) $next['batch_id'],
                        $next['location_id'] === null ? null : (int) $next['location_id'],
                    );
                } catch (\Throwable $e) {
                    $failed[] = ['serial_id' => $id, 'serial_no' => $row['serial_no'], 'reason' => $e->getMessage()];
                    continue;
                }
                $set = $patch + ['updated_by' => $a['session']['uuid'], 'updated_at' => $now];
                $db->table('inv_serials')->where('cmp_id', $cmpId)->where('serial_id', $id)->update($set);
                $audit->log($cmpId, 'serial', $id, 'serial.bulk_update', $a['session']['uuid'], [], $row, $set);
                $updated[] = ['serial_id' => $id, 'serial_no' => $row['serial_no']];
            }

            return $this->respond(['data' => [
                'updated'       => $updated,
                'failed'        => $failed,
                'updated_count' => count($updated),
                'failed_count'  => count($failed),
                'changed'       => array_keys($patch),
            ]]);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    // ------------------------------------------------------------------ helpers

    private function baseQuery(int $cmpId)
    {
        return \Config\Database::connect()->table('inv_serials s')
            ->join('inv_items i', 'i.item_id = s.item_id', 'left')
            ->join('inv_warehouses w', 'w.warehouse_id = s.warehouse_id', 'left')
            ->join('inv_batches b', 'b.batch_id = s.batch_id', 'left')
            ->join('inv_locations l', 'l.location_id = s.location_id', 'left')
            ->where('s.cmp_id', $cmpId);
    }

    /**
     * Every filter the workspace can send, applied once.
     *
     * Shared by `index` and `summary` on purpose: the counters have to describe
     * the rows underneath them, and two copies of this list is how a card comes
     * to disagree with the table it sits above.
     *
     * @param \CodeIgniter\Database\BaseBuilder $b
     * @return \CodeIgniter\Database\BaseBuilder
     */
    private function applyFilters($b)
    {
        foreach (['item_id', 'warehouse_id', 'batch_id', 'location_id'] as $f) {
            if ($v = (int) $this->request->getGet($f)) {
                $b->where('s.' . $f, $v);
            }
        }
        foreach (['item_grp_id', 'brand_id', 'stock_cat_id'] as $f) {
            if ($v = (int) $this->request->getGet($f)) {
                $b->where('i.' . $f, $v);
            }
        }

        $status = strtolower(trim((string) ($this->request->getGet('status') ?? '')));
        if ($status !== '') {
            $wanted = array_values(array_filter(array_map('trim', explode(',', $status))));
            // `status=in_stock` and `status=allocated` both have to work: the
            // KPI cards drill in by BUCKET and the filter bar by status, and a
            // card that opened a list showing nothing would be a dead card.
            $expanded = [];
            foreach ($wanted as $token) {
                foreach (self::STATUS_GROUPS[$token] ?? [$token] as $s) {
                    $expanded[] = $s;
                }
            }
            $b->whereIn('s.status', array_values(array_unique($expanded)));
        }

        // Warranty, as the screen means it: the window and the day it is
        // measured from are the server's, so a browser in another timezone
        // cannot disagree with the card it just clicked.
        $today = date('Y-m-d');
        $soonDays = (int) ($this->request->getGet('warranty_days') ?? self::WARRANTY_SOON_DAYS);
        $soonDays = max(1, min(3650, $soonDays));
        $warranty = strtolower(trim((string) ($this->request->getGet('warranty_status') ?? '')));
        if ($warranty === 'expired') {
            $b->where('s.warranty_until IS NOT NULL', null, false)->where('s.warranty_until <', $today);
        } elseif ($warranty === 'expiring') {
            $b->where('s.warranty_until >=', $today)->where('s.warranty_until <=', date('Y-m-d', strtotime($today . ' +' . $soonDays . ' days')));
        } elseif ($warranty === 'active') {
            $b->where('s.warranty_until >=', $today);
        } elseif ($warranty === 'none') {
            $b->where('s.warranty_until', null);
        }
        foreach ([['warranty_from', 's.warranty_until >='], ['warranty_to', 's.warranty_until <=']] as [$param, $clause]) {
            $v = trim((string) ($this->request->getGet($param) ?? ''));
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
                $b->where($clause, $v);
            }
        }
        foreach ([['created_from', 's.created_at >=', ' 00:00:00'], ['created_to', 's.created_at <=', ' 23:59:59'], ['updated_from', 's.updated_at >=', ' 00:00:00'], ['updated_to', 's.updated_at <=', ' 23:59:59']] as [$param, $clause, $suffix]) {
            $v = trim((string) ($this->request->getGet($param) ?? ''));
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
                $b->where($clause, $v . $suffix);
            }
        }

        foreach ([['cost_min', 's.unit_cost >='], ['cost_max', 's.unit_cost <=']] as [$param, $clause]) {
            $v = trim((string) ($this->request->getGet($param) ?? ''));
            if ($v !== '' && is_numeric($v)) {
                $b->where($clause, (float) $v);
            }
        }

        $hasBatch = trim((string) ($this->request->getGet('has_batch') ?? ''));
        if ($hasBatch === '1') {
            $b->where('s.batch_id IS NOT NULL', null, false);
        } elseif ($hasBatch === '0') {
            $b->where('s.batch_id', null);
        }
        $placed = trim((string) ($this->request->getGet('placed') ?? ''));
        if ($placed === '1') {
            $b->where('s.warehouse_id IS NOT NULL', null, false);
        } elseif ($placed === '0') {
            $b->where('s.warehouse_id', null);
        }

        $q = trim((string) ($this->request->getGet('q') ?? ''));
        if ($q !== '') {
            // A scanner types the whole code and presses Enter, so an exact hit
            // on the serial has to be reachable; a person types three characters
            // of an item name, so a contains match has to be as well. Both are
            // the same clause — the index on (cmp, item, serial_no) still serves
            // the prefix form, which is the one `q_mode=prefix` asks for.
            $side = (string) ($this->request->getGet('q_mode') ?? 'contains') === 'prefix' ? 'after' : 'both';
            $needle = mb_strtolower($q);
            $b->groupStart()
                ->like('LOWER(s.serial_no)', $needle, $side, null, true)
                ->orLike('LOWER(i.item_name)', $needle, $side, null, true)
                ->orLike('LOWER(i.item_sku)', $needle, $side, null, true)
                ->orLike('LOWER(i.item_upc)', $needle, $side, null, true)
                ->orLike('LOWER(b.batch_no)', $needle, $side, null, true)
                ->orLike('LOWER(w.warehouse_name)', $needle, $side, null, true)
                ->orLike('LOWER(l.location_code)', $needle, $side, null, true)
                ->groupEnd();
        }

        return $b;
    }

    /** @return array<string, mixed>|null */
    private function fetch(int $cmpId, int $id, bool $costVisible = true): ?array
    {
        $row = $this->baseQuery($cmpId)->where('s.serial_id', $id)->select(self::SELECT)->get()->getRowArray();

        return $row ? $this->present($row, $costVisible) : null;
    }

    /** @return array<string, mixed> */
    private function present(array $row, bool $costVisible = true): array
    {
        $row['attributes'] = isset($row['attributes_json']) ? json_decode((string) $row['attributes_json'], true) : null;
        unset($row['attributes_json']);
        if (!$costVisible) {
            // Removed, not blanked: a null the client re-formats is still a null
            // the client received, and `unit_cost: 0` would be a lie.
            unset($row['unit_cost']);
        } elseif (isset($row['unit_cost'])) {
            $row['unit_cost'] = (float) $row['unit_cost'];
        }

        return $row;
    }

    /** @param array<string, mixed> $a the authorize() result */
    private function mayReadCost(array $a): bool
    {
        try {
            return $this->access->hasPermission((string) ($a['session']['uuid'] ?? ''), (int) $a['ctx']['cmp_id'], self::COST_PERM, $a['session']);
        } catch (\Throwable $e) {
            log_message('error', 'serial cost permission check failed: ' . $e->getMessage());

            return false;
        }
    }

    /**
     * The company's base currency, read-only.
     *
     * Sent with the counters for the same reason the registers hub sends it: the
     * one figure on the strip that carries a symbol is the one this endpoint
     * produced, and a screen that formatted it from a separately-fetched setting
     * could print the previous company's symbol while that request was in
     * flight. `settings.read` is not required — a store keeper may not open the
     * settings screen and still has to be able to read a cost column.
     */
    private function baseCurrency(int $cmpId): string
    {
        $db = \Config\Database::connect();
        if (!SchemaCache::tableExists($db, 'inv_company_settings')) {
            return 'INR';
        }
        $res = $db->table('inv_company_settings')->select('base_currency_code')->where('cmp_id', $cmpId)->get();
        $row = $res === false ? null : $res->getRowArray();
        $code = strtoupper(trim((string) ($row['base_currency_code'] ?? '')));

        return $code !== '' ? $code : 'INR';
    }

    /** @return array<string, mixed>|null */
    private function decodeJson(?string $json): ?array
    {
        if ($json === null || $json === '') {
            return null;
        }
        $decoded = json_decode($json, true);

        return is_array($decoded) ? $decoded : null;
    }

    /** @return array<string, mixed> the item row (must be live, active and serial-tracked) */
    private function requireSerialItem(int $cmpId, int $itemId): array
    {
        if ($itemId <= 0) {
            throw InventoryException::validation('item_id is required', ['field' => 'item_id']);
        }
        $item = \Config\Database::connect()->table('inv_items')->select('item_id, item_name, track_serial')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('deleted_at', null)->where('is_active', 1)->get()->getRowArray();
        if (!$item) {
            throw InventoryException::validation('Item #' . $itemId . ' not found or inactive in this company', ['field' => 'item_id', 'item_id' => $itemId]);
        }
        if ((int) $item['track_serial'] !== 1) {
            throw InventoryException::validation('Item "' . $item['item_name'] . '" does not track serial numbers (track_serial)', ['field' => 'item_id', 'item_id' => $itemId]);
        }

        return $item;
    }

    private function validateRefs(int $cmpId, int $itemId, ?int $warehouseId, ?int $batchId, ?int $locationId): void
    {
        $db = \Config\Database::connect();
        if ($warehouseId !== null && $db->table('inv_warehouses')->where('cmp_id', $cmpId)->where('warehouse_id', $warehouseId)->where('deleted_at', null)->countAllResults() === 0) {
            throw InventoryException::validation('Warehouse #' . $warehouseId . ' not found in this company', ['field' => 'warehouse_id']);
        }
        if ($batchId !== null && $db->table('inv_batches')->where('cmp_id', $cmpId)->where('batch_id', $batchId)->where('item_id', $itemId)->countAllResults() === 0) {
            throw InventoryException::validation('Batch #' . $batchId . ' not found for this item', ['field' => 'batch_id']);
        }
        if ($locationId !== null) {
            $loc = $db->table('inv_locations')->select('warehouse_id')->where('cmp_id', $cmpId)->where('location_id', $locationId)->where('deleted_at', null)->get()->getRowArray();
            if (!$loc) {
                throw InventoryException::validation('Location #' . $locationId . ' not found in this company', ['field' => 'location_id']);
            }
            if ($warehouseId !== null && (int) $loc['warehouse_id'] !== $warehouseId) {
                throw InventoryException::validation('Location #' . $locationId . ' does not belong to warehouse #' . $warehouseId, ['field' => 'location_id']);
            }
        }
    }

    /** @return array<string, mixed> */
    private function buildRow(int $cmpId, array $body, ?array $existing): array
    {
        $itemId = (int) ($body['item_id'] ?? 0);
        if ($existing && $itemId !== (int) $existing['item_id']) {
            throw InventoryException::validation('item_id cannot be changed on an existing serial', ['field' => 'item_id']);
        }
        $this->requireSerialItem($cmpId, $itemId);
        $row = ['item_id' => $itemId];
        foreach (self::COLUMNS as $col) {
            if (array_key_exists($col, $body)) {
                $v = $body[$col];
                $row[$col] = is_string($v) ? trim($v) : $v;
                if ($row[$col] === '') {
                    $row[$col] = null;
                }
            }
        }
        if (empty($row['serial_no'])) {
            throw InventoryException::validation('serial_no is required', ['field' => 'serial_no']);
        }
        $row['serial_no'] = substr((string) $row['serial_no'], 0, 128);
        foreach (['batch_id', 'warehouse_id', 'location_id'] as $ref) {
            $row[$ref] = isset($row[$ref]) && (int) $row[$ref] > 0 ? (int) $row[$ref] : null;
        }
        $this->validateRefs($cmpId, $itemId, $row['warehouse_id'], $row['batch_id'], $row['location_id']);
        $status = strtolower((string) ($row['status'] ?? ($existing['status'] ?? 'expected'))) ?: 'expected';
        if (!in_array($status, self::STATUSES, true)) {
            throw InventoryException::validation('status must be one of ' . implode(', ', self::STATUSES), ['field' => 'status']);
        }
        $row['status'] = $status;
        if (array_key_exists('unit_cost', $row) && $row['unit_cost'] !== null) {
            $row['unit_cost'] = round((float) $row['unit_cost'], 4);
        }
        if (isset($row['warranty_until']) && !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $row['warranty_until'])) {
            throw InventoryException::validation('warranty_until must be YYYY-MM-DD', ['field' => 'warranty_until']);
        }
        if (array_key_exists('attributes', $body)) {
            $row['attributes_json'] = is_array($body['attributes']) ? json_encode($body['attributes'], JSON_UNESCAPED_UNICODE) : null;
        }
        $dup = \Config\Database::connect()->table('inv_serials')->where('cmp_id', $cmpId)->where('item_id', $itemId)->where('serial_no', $row['serial_no']);
        if ($existing) {
            $dup->where('serial_id !=', (int) $existing['serial_id']);
        }
        if ($dup->countAllResults() > 0) {
            throw InventoryException::conflict('Serial "' . $row['serial_no'] . '" already exists for this item', ['field' => 'serial_no', 'serial_no' => $row['serial_no'], 'item_id' => $itemId]);
        }

        return $row;
    }
}
