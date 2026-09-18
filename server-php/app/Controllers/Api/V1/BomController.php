<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Exceptions\InventoryException;
use App\Services\AuditService;
use App\Services\BomCostService;
use App\Services\BomService;
use App\Services\SchemaCache;

/**
 * /api/v1/bill-of-materials — inv_bom_headers + inv_bom_lines.
 *
 * Lines ride along on the header resource and are replaced wholesale on update.
 * Permission base: masters.bill_of_materials.
 *
 * Beyond CRUD it serves the three things the bill-of-materials workspace reads
 * and nothing else can answer without a request per row: `summary` (the figures
 * above the list), `with_preview` (the first few components of every row in one
 * extra query) and `{id}/cost` (the costed component breakdown). Costing comes
 * from Inventory's own valuation state via BomCostService — never from Books,
 * and never from a default rate.
 */
class BomController extends BaseController
{
    private const PERM = 'masters.bill_of_materials';
    private const SORT = [
        'bom_name'           => 'h.bom_name',
        'bom_id'             => 'h.bom_id',
        'bom_code'           => 'h.bom_id',
        'finished_item_name' => 'fi.item_name',
        'yield_qty'          => 'h.yield_qty',
        'is_active'          => 'h.is_active',
        'created_at'         => 'h.created_at',
        'updated_at'         => 'h.updated_at',
    ];
    /** How many components a list row previews before it says "+N more". */
    private const PREVIEW_COMPONENTS = 4;

    public function index()
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $p = $this->listParams(100, 1000, 'bom_name');
        $b = $this->baseQuery($cmpId);
        $this->applyListFilters($b, $cmpId);

        $componentCount = $this->componentCountExpr($cmpId);
        $total = (clone $b)->countAllResults(false);

        $order = $p['sort'] === 'component_count' ? $componentCount : (self::SORT[$p['sort']] ?? 'h.bom_name');
        $rows = $b->select('h.bom_id, h.bom_uuid, h.bom_name, h.finished_item_id, h.yield_qty, h.yield_unit_id, h.is_active, h.created_at, h.created_by, h.updated_at, h.updated_by'
            . ', fi.item_name AS finished_item_name, fi.item_sku AS finished_item_sku, fi.is_active AS finished_item_is_active, fi.item_grp_id AS finished_item_grp_id'
            . ', ig.grp_name AS finished_item_group_name, yu.unit_symbol AS yield_unit_symbol')
            // Raw expression, so escaping is off; $cmpId is cast to int above.
            ->orderBy($order, $p['order'], false)
            ->limit($p['limit'], $p['offset'])->get()->getResultArray();

        $bomIds = array_map(static fn ($r) => (int) $r['bom_id'], $rows);
        $withPreview = (int) ($this->request->getGet('with_preview') ?? 0) === 1;
        // With the preview on, the lines are already in hand and the counts come
        // out of them; without it, one grouped count query answers the column.
        $lines = $withPreview ? (new BomService())->lines($cmpId, $bomIds) : [];
        $counts = $withPreview ? [] : $this->lineCounts($cmpId, $bomIds);
        $actors = $this->actorNames($cmpId, array_merge(array_column($rows, 'created_by'), array_column($rows, 'updated_by')));

        foreach ($rows as &$r) {
            $bomId = (int) $r['bom_id'];
            $r['bom_code'] = self::bomCode($bomId);
            $r['yield_qty'] = (float) $r['yield_qty'];
            $r['created_by_name'] = $actors[(string) ($r['created_by'] ?? '')] ?? null;
            $r['updated_by_name'] = $actors[(string) ($r['updated_by'] ?? '')] ?? null;
            if ($withPreview) {
                $r += self::previewFrom($lines[$bomId] ?? []);
            } else {
                $r['line_count'] = $counts[$bomId]['total'] ?? 0;
                $r['component_count'] = $counts[$bomId]['component'] ?? 0;
            }
        }

        return $this->respondList($rows, $total, $p['limit'], $p['offset']);
    }

    /**
     * The figures above the list: counts, the average component depth, the
     * finished items covered and what the active bills cost in material.
     *
     * Company-wide on purpose — the list's own filters move underneath it, and
     * a "Total BOMs" that changed every time a reader narrowed the table would
     * answer a different question from the one the card asks. The cost is real
     * or it is null; it is never zero standing in for "not known".
     */
    public function summary()
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $db = \Config\Database::connect();

        $header = $db->query(
            'SELECT COUNT(*) AS total'
            . ', COUNT(*) FILTER (WHERE is_active = 1) AS active'
            . ', COUNT(DISTINCT finished_item_id) AS linked_items'
            . ', COUNT(DISTINCT finished_item_id) FILTER (WHERE is_active = 1) AS linked_items_active'
            . ', COUNT(*) FILTER (WHERE created_at >= ?) AS created_recent'
            . ', COUNT(*) FILTER (WHERE created_at >= ? AND created_at < ?) AS created_previous'
            . ' FROM inv_bom_headers WHERE cmp_id = ? AND deleted_at IS NULL',
            [$this->daysAgo(30), $this->daysAgo(60), $this->daysAgo(30), $cmpId],
        )->getRowArray() ?: [];

        $total = (int) ($header['total'] ?? 0);
        $active = (int) ($header['active'] ?? 0);

        $lines = $db->table('inv_bom_headers h')
            ->select('h.bom_id, h.is_active, l.item_id, l.qty, l.unit_id, l.scrap_percent, l.line_kind')
            ->join('inv_bom_lines l', 'l.bom_id = h.bom_id AND l.cmp_id = h.cmp_id', 'inner')
            ->where('h.cmp_id', $cmpId)->where('h.deleted_at', null)
            ->get()->getResultArray();

        $components = 0;
        $byBom = [];
        foreach ($lines as $l) {
            if (($l['line_kind'] ?? 'component') !== 'component') {
                continue;
            }
            $components++;
            if ((int) $l['is_active'] === 1) {
                $byBom[(int) $l['bom_id']][] = $l;
            }
        }

        $cost = new BomCostService();
        $itemIds = [];
        foreach ($byBom as $bomLines) {
            foreach ($bomLines as $l) {
                $itemIds[] = (int) $l['item_id'];
            }
        }
        $costs = $cost->baseUnitCosts($cmpId, $itemIds);
        $material = 0.0;
        $pricedBoms = 0;
        $unpricedBoms = 0;
        foreach ($byBom as $bomLines) {
            $costed = $cost->costLines($cmpId, $bomLines, $costs);
            $material += $costed['total_cost'];
            if ($costed['complete']) {
                $pricedBoms++;
            } else {
                $unpricedBoms++;
            }
        }
        // Nothing could be priced at all: say so rather than print a zero, which
        // a reader would take as "these bills cost nothing to build".
        $costKnown = $pricedBoms > 0;

        return $this->respond(['data' => [
            'total'                   => $total,
            'active'                  => $active,
            'inactive'                => max(0, $total - $active),
            'average_components'      => $total > 0 ? round($components / $total, 1) : 0.0,
            'component_lines'         => $components,
            'linked_finished_items'   => (int) ($header['linked_items'] ?? 0),
            'linked_finished_items_active' => (int) ($header['linked_items_active'] ?? 0),
            'created_last_30_days'    => (int) ($header['created_recent'] ?? 0),
            'created_previous_30_days' => (int) ($header['created_previous'] ?? 0),
            'estimated_material_cost' => $costKnown ? round($material, 2) : null,
            'costed_boms'             => $pricedBoms,
            'partially_costed_boms'   => $unpricedBoms,
            'currency'                => $cost->baseCurrency($cmpId),
        ]]);
    }

    /**
     * GET bill-of-materials/{id}/cost — the costed component breakdown.
     *
     * Separate from `show` because it is a different question with a different
     * cost: the editor opens a BOM constantly and does not need valuation read
     * every time, while the costing drawer needs every rate resolved.
     */
    public function cost($id = null)
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $bom = $this->present($cmpId, (int) $id);
        if (!$bom) {
            return $this->failStructured(404, 'not_found', 'Bill of materials not found');
        }
        $service = new BomCostService();
        $lines = (array) ($bom['lines'] ?? []);
        $costs = $service->baseUnitCosts($cmpId, array_map(static fn ($l) => (int) $l['item_id'], $lines));
        $costed = $service->costLines($cmpId, $lines, $costs);
        $yield = (float) ($bom['yield_qty'] ?? 1);

        return $this->respond(['data' => [
            'bom_id'              => (int) $bom['bom_id'],
            'bom_code'            => self::bomCode((int) $bom['bom_id']),
            'bom_name'            => $bom['bom_name'],
            'currency'            => $service->baseCurrency($cmpId),
            'yield_qty'           => $yield,
            'yield_unit_symbol'   => $bom['yield_unit_symbol'] ?? null,
            'lines'               => $costed['lines'],
            'component_cost'      => $costed['component_cost'],
            'wastage_cost'        => $costed['wastage_cost'],
            'total_cost'          => $costed['total_cost'],
            'cost_per_unit'       => $yield > 0.0001 ? round($costed['total_cost'] / $yield, 4) : null,
            'priced_components'   => $costed['priced_components'],
            'unpriced_components' => $costed['unpriced_components'],
            'cost_available'      => $costed['priced_components'] > 0,
            'cost_complete'       => $costed['complete'],
        ]]);
    }

    /**
     * POST bill-of-materials/{id}/duplicate — a copy, inactive.
     *
     * Inactive on purpose: a duplicate is the start of an edit, and a second
     * active bill for the same finished item appearing the moment somebody
     * clicked Duplicate is a production instruction nobody wrote.
     */
    public function duplicate($id = null)
    {
        $a = $this->authorize(self::PERM . '.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $source = $this->present($cmpId, (int) $id);
        if (!$source) {
            return $this->failStructured(404, 'not_found', 'Bill of materials not found');
        }
        $body = $this->request->getJSON(true) ?? [];
        $name = trim((string) ($body['bom_name'] ?? ''));
        if ($name === '') {
            $name = $this->uniqueCopyName($cmpId, (string) $source['bom_name']);
        }
        $db = \Config\Database::connect();
        try {
            $payload = [
                'bom_name'         => $name,
                'finished_item_id' => (int) $source['finished_item_id'],
                'yield_qty'        => (float) $source['yield_qty'],
                'yield_unit_id'    => $source['yield_unit_id'] ?? null,
            ];
            $row = $this->buildHeader($cmpId, $payload, null);
            $lines = $this->buildLines($cmpId, (array) $source['lines'], (int) $row['finished_item_id']);
            $now = date('Y-m-d H:i:s');
            $row += ['cmp_id' => $cmpId, 'is_active' => 0, 'created_by' => $a['session']['uuid'], 'created_at' => $now, 'updated_by' => $a['session']['uuid'], 'updated_at' => $now];
            $db->transStart();
            $db->table('inv_bom_headers')->insert($row);
            $bomId = (int) $db->insertID();
            $this->writeLines($db, $cmpId, $bomId, $lines);
            $db->transComplete();
            if ($db->transStatus() === false) {
                throw new \RuntimeException('Could not duplicate bill of materials', 500);
            }
            (new AuditService())->log($cmpId, 'bom', $bomId, 'bom.duplicate', $a['session']['uuid'], ['source_bom_id' => (int) $id], null, $row + ['lines' => $lines]);

            return $this->respondCreated(['data' => $this->present($cmpId, $bomId)]);
        } catch (\Throwable $e) {
            $db->transRollback();

            return $this->failFromException($e);
        }
    }

    public function show($id = null)
    {
        $a = $this->authorize(self::PERM . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $row = $this->present((int) $a['ctx']['cmp_id'], (int) $id);

        return $row ? $this->respond(['data' => $row]) : $this->failStructured(404, 'not_found', 'Bill of materials not found');
    }

    public function create()
    {
        $a = $this->authorize(self::PERM . '.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        $db = \Config\Database::connect();
        try {
            $row = $this->buildHeader($cmpId, $body, null);
            $lines = $this->buildLines($cmpId, (array) ($body['lines'] ?? []), (int) $row['finished_item_id']);
            $now = date('Y-m-d H:i:s');
            $row += ['cmp_id' => $cmpId, 'is_active' => isset($body['is_active']) ? (!empty($body['is_active']) ? 1 : 0) : 1, 'created_by' => $a['session']['uuid'], 'created_at' => $now, 'updated_by' => $a['session']['uuid'], 'updated_at' => $now];
            $db->transStart();
            $db->table('inv_bom_headers')->insert($row);
            $bomId = (int) $db->insertID();
            $this->writeLines($db, $cmpId, $bomId, $lines);
            $db->transComplete();
            if ($db->transStatus() === false) {
                throw new \RuntimeException('Could not save bill of materials', 500);
            }
            (new AuditService())->log($cmpId, 'bom', $bomId, 'bom.create', $a['session']['uuid'], [], null, $row + ['lines' => $lines]);

            return $this->respondCreated(['data' => $this->present($cmpId, $bomId)]);
        } catch (\Throwable $e) {
            $db->transRollback();

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
        $existing = $this->find($cmpId, (int) $id);
        if (!$existing) {
            return $this->failStructured(404, 'not_found', 'Bill of materials not found');
        }
        $body = $this->request->getJSON(true) ?? [];
        $db = \Config\Database::connect();
        try {
            $row = $this->buildHeader($cmpId, array_merge($existing, $body), $existing);
            $replaceLines = array_key_exists('lines', $body);
            $lines = $replaceLines
                ? $this->buildLines($cmpId, (array) $body['lines'], (int) $row['finished_item_id'])
                : $this->buildLines($cmpId, (new BomService())->lines($cmpId, [(int) $id])[(int) $id] ?? [], (int) $row['finished_item_id']);
            if (array_key_exists('is_active', $body)) {
                $row['is_active'] = !empty($body['is_active']) ? 1 : 0;
            }
            $row['updated_by'] = $a['session']['uuid'];
            $row['updated_at'] = date('Y-m-d H:i:s');
            $db->transStart();
            $db->table('inv_bom_headers')->where('bom_id', (int) $id)->where('cmp_id', $cmpId)->update($row);
            if ($replaceLines) {
                $db->table('inv_bom_lines')->where('bom_id', (int) $id)->where('cmp_id', $cmpId)->delete();
                $this->writeLines($db, $cmpId, (int) $id, $lines);
            }
            $db->transComplete();
            if ($db->transStatus() === false) {
                throw new \RuntimeException('Could not save bill of materials', 500);
            }
            (new AuditService())->log($cmpId, 'bom', (int) $id, 'bom.update', $a['session']['uuid'], [], $existing, $row + ($replaceLines ? ['lines' => $lines] : []));

            return $this->respond(['data' => $this->present($cmpId, (int) $id)]);
        } catch (\Throwable $e) {
            $db->transRollback();

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
        $existing = $this->find($cmpId, (int) $id);
        if (!$existing) {
            return $this->failStructured(404, 'not_found', 'Bill of materials not found');
        }
        $db = \Config\Database::connect();
        $used = $db->table('inv_documents')->where('cmp_id', $cmpId)->where('document_type', 'PRODUCTION')
            ->where('status !=', 'CANCELLED')
            ->where("(metadata_json->>'bom_id') = '" . (int) $id . "'", null, false)
            ->countAllResults();
        if ($used > 0) {
            return $this->failStructured(409, 'delete_blocked', 'Bill of materials is used by ' . $used . ' production document(s) and cannot be deleted', ['guard' => 'production document(s)', 'count' => $used]);
        }
        $now = date('Y-m-d H:i:s');
        $db->table('inv_bom_headers')->where('bom_id', (int) $id)->where('cmp_id', $cmpId)->update(['deleted_at' => $now, 'deleted_by' => $a['session']['uuid'], 'is_active' => 0, 'updated_at' => $now]);
        (new AuditService())->log($cmpId, 'bom', (int) $id, 'bom.delete', $a['session']['uuid'], [], $existing, null);

        return $this->respondDeleted(['data' => ['bom_id' => (int) $id]]);
    }

    /**
     * POST bill-of-materials/{id}/explode {production_qty, warehouse_id?, finished_rate?, document_date?, narration?, document_no?}
     * -> the PRODUCTION create payload (BomService::productionPayload): component OUT lines, by-product IN lines,
     * finished IN line and metadata {bom_id, production_qty, finished_rate, warehouse_id}. Nothing is saved.
     */
    public function explode($id = null)
    {
        $a = $this->authorizeAny([self::PERM . '.read', 'documents.production.create', 'documents.create']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        $header = [];
        foreach (['document_date', 'document_no', 'narration', 'metadata'] as $k) {
            if (array_key_exists($k, $body)) {
                $header[$k] = $body[$k];
            }
        }
        try {
            $payload = (new BomService())->productionPayload(
                $cmpId,
                (int) $id,
                (float) ($body['production_qty'] ?? 0),
                isset($body['warehouse_id']) && (int) $body['warehouse_id'] > 0 ? (int) $body['warehouse_id'] : null,
                (float) ($body['finished_rate'] ?? 0),
                $header,
            );

            return $this->respond(['data' => $payload]);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
    }

    // ------------------------------------------------------------------ helpers

    private function baseQuery(int $cmpId)
    {
        return \Config\Database::connect()->table('inv_bom_headers h')
            ->join('inv_items fi', 'fi.item_id = h.finished_item_id', 'left')
            ->join('inv_item_groups ig', 'ig.item_grp_id = fi.item_grp_id', 'left')
            ->join('inv_uom yu', 'yu.unit_id = h.yield_unit_id', 'left')
            ->where('h.cmp_id', $cmpId)->where('h.deleted_at', null);
    }

    /**
     * The list's filters, shared by the rows query and its count.
     *
     * @param \CodeIgniter\Database\BaseBuilder $b
     */
    private function applyListFilters($b, int $cmpId): void
    {
        $status = strtolower((string) ($this->request->getGet('status') ?? ''));
        if ($status === 'active' || (int) ($this->request->getGet('active_only') ?? 0) === 1) {
            $b->where('h.is_active', 1);
        } elseif ($status === 'inactive') {
            $b->where('h.is_active', 0);
        }
        if ($fi = (int) $this->request->getGet('finished_item_id')) {
            $b->where('h.finished_item_id', $fi);
        }
        if ($grp = (int) $this->request->getGet('item_grp_id')) {
            $b->where('fi.item_grp_id', $grp);
        }
        if ($ci = (int) $this->request->getGet('component_item_id')) {
            $b->where('EXISTS (SELECT 1 FROM inv_bom_lines cl WHERE cl.bom_id = h.bom_id AND cl.cmp_id = ' . $cmpId . ' AND cl.item_id = ' . $ci . ')', null, false);
        }
        if ((int) ($this->request->getGet('has_scrap') ?? 0) === 1) {
            $b->where('EXISTS (SELECT 1 FROM inv_bom_lines cl WHERE cl.bom_id = h.bom_id AND cl.cmp_id = ' . $cmpId . ' AND cl.scrap_percent > 0)', null, false);
        }
        if ((int) ($this->request->getGet('has_by_products') ?? 0) === 1) {
            $b->where("EXISTS (SELECT 1 FROM inv_bom_lines cl WHERE cl.bom_id = h.bom_id AND cl.cmp_id = " . $cmpId . " AND cl.line_kind = 'by_product')", null, false);
        }
        $componentCount = $this->componentCountExpr($cmpId);
        $min = $this->request->getGet('min_components');
        if ($min !== null && $min !== '' && (int) $min > 0) {
            $b->where($componentCount . ' >= ' . (int) $min, null, false);
        }
        $max = $this->request->getGet('max_components');
        if ($max !== null && $max !== '' && (int) $max > 0) {
            $b->where($componentCount . ' <= ' . (int) $max, null, false);
        }
        foreach (['created_at' => 'created', 'updated_at' => 'updated'] as $column => $prefix) {
            $from = trim((string) ($this->request->getGet($prefix . '_from') ?? ''));
            if ($from !== '') {
                $b->where('h.' . $column . ' >=', $from . ' 00:00:00');
            }
            $to = trim((string) ($this->request->getGet($prefix . '_to') ?? ''));
            if ($to !== '') {
                $b->where('h.' . $column . ' <=', $to . ' 23:59:59');
            }
            $actor = trim((string) ($this->request->getGet($prefix . '_by') ?? ''));
            if ($actor !== '') {
                $b->where('h.' . $prefix . '_by', $actor);
            }
        }
        $q = trim((string) ($this->request->getGet('q') ?? ''));
        if ($q !== '') {
            $needle = mb_strtolower($q);
            $b->groupStart()
                ->like('LOWER(h.bom_name)', $needle, 'both', null, true)
                ->orLike('LOWER(fi.item_name)', $needle, 'both', null, true)
                ->orLike('LOWER(fi.item_sku)', $needle, 'both', null, true)
                ->groupEnd();
        }
    }

    /**
     * Component lines of the row, as a scalar subquery.
     *
     * Used for the `min_components` / `max_components` filters and the
     * `component_count` sort, which have to happen in SQL: sorting the page
     * that was already fetched would order 50 rows out of 400 by a column the
     * database never saw. `$cmpId` is an int cast by the caller.
     */
    private function componentCountExpr(int $cmpId): string
    {
        return "(SELECT COUNT(*) FROM inv_bom_lines cl WHERE cl.bom_id = h.bom_id AND cl.cmp_id = {$cmpId} AND cl.line_kind = 'component')";
    }

    /**
     * The reference a reader quotes: BOM-007.
     *
     * Formatted from the row's own primary key rather than stored, so it cannot
     * collide and no sequence has to be kept. It is produced HERE, not in the
     * browser, so the screen, the CSV, the PDF and the print sheet all quote
     * the same string, and a real `bom_code` column can take over later without
     * a client change.
     */
    private static function bomCode(int $bomId): string
    {
        return 'BOM-' . str_pad((string) $bomId, 3, '0', STR_PAD_LEFT);
    }

    /**
     * Component chips for one row: the first few, plus the counts behind them.
     *
     * @param list<array<string, mixed>> $lines
     * @return array<string, mixed>
     */
    private static function previewFrom(array $lines): array
    {
        $components = array_values(array_filter($lines, static fn ($l) => ($l['line_kind'] ?? 'component') === 'component'));
        $preview = [];
        foreach (array_slice($components, 0, self::PREVIEW_COMPONENTS) as $l) {
            $preview[] = [
                'item_id'     => (int) $l['item_id'],
                'item_name'   => $l['item_name'] ?? null,
                'item_sku'    => $l['item_sku'] ?? null,
                'qty'         => (float) $l['qty'],
                'unit_symbol' => $l['unit_symbol'] ?? null,
                'scrap_percent' => (float) ($l['scrap_percent'] ?? 0),
                'item_is_active' => isset($l['item_is_active']) ? (int) $l['item_is_active'] : null,
            ];
        }

        return [
            'line_count'        => count($lines),
            'component_count'   => count($components),
            'by_product_count'  => count(array_filter($lines, static fn ($l) => ($l['line_kind'] ?? '') === 'by_product')),
            'scrap_count'       => count(array_filter($lines, static fn ($l) => ($l['line_kind'] ?? '') === 'scrap')),
            'components_preview' => $preview,
        ];
    }

    /**
     * uuid -> the name the company knows that person by.
     *
     * A list that says "by 9f3c1a…" names nobody. The mapping is the company's
     * own member roster; an actor with no row there (a service key, a member
     * removed since) simply has no name and the client falls back to the id it
     * already has.
     *
     * @param list<string|null> $uuids
     * @return array<string, string>
     */
    private function actorNames(int $cmpId, array $uuids): array
    {
        $ids = array_values(array_unique(array_filter(array_map(static fn ($u) => trim((string) $u), $uuids), static fn ($u) => $u !== '')));
        $db = \Config\Database::connect();
        if ($ids === [] || !SchemaCache::tableExists($db, 'inv_company_members')) {
            return [];
        }
        $out = [];
        foreach (array_chunk($ids, 200) as $chunk) {
            $rows = $db->table('inv_company_members')->select('uuid, display_name')
                ->where('cmp_id', $cmpId)->whereIn('uuid', $chunk)->get()->getResultArray();
            foreach ($rows as $r) {
                $name = trim((string) ($r['display_name'] ?? ''));
                if ($name !== '') {
                    $out[(string) $r['uuid']] = $name;
                }
            }
        }

        return $out;
    }

    private function daysAgo(int $days): string
    {
        return date('Y-m-d H:i:s', strtotime('-' . $days . ' days'));
    }

    /** "Office chair" -> "Office chair (copy)", then "(copy 2)" while the name is taken. */
    private function uniqueCopyName(int $cmpId, string $name): string
    {
        $db = \Config\Database::connect();
        $stem = substr($name, 0, 230);
        for ($n = 1; $n <= 50; $n++) {
            $candidate = $n === 1 ? $stem . ' (copy)' : $stem . ' (copy ' . $n . ')';
            $taken = $db->table('inv_bom_headers')->where('cmp_id', $cmpId)
                ->where('LOWER(bom_name)', mb_strtolower($candidate))->where('deleted_at', null)->countAllResults();
            if ($taken === 0) {
                return $candidate;
            }
        }

        return $stem . ' (copy ' . date('YmdHis') . ')';
    }

    /** @return array<string, mixed>|null */
    private function find(int $cmpId, int $id): ?array
    {
        return \Config\Database::connect()->table('inv_bom_headers')->where('cmp_id', $cmpId)->where('bom_id', $id)->where('deleted_at', null)->get()->getRowArray() ?: null;
    }

    /** @return array<string, mixed>|null */
    private function present(int $cmpId, int $id): ?array
    {
        $row = $this->baseQuery($cmpId)->where('h.bom_id', $id)
            ->select('h.*, fi.item_name AS finished_item_name, fi.item_sku AS finished_item_sku, fi.unit_id AS finished_item_unit_id, fi.is_active AS finished_item_is_active'
                . ', fi.item_grp_id AS finished_item_grp_id, ig.grp_name AS finished_item_group_name, yu.unit_symbol AS yield_unit_symbol')
            ->get()->getRowArray();
        if (!$row) {
            return null;
        }
        $row['bom_code'] = self::bomCode($id);
        $row['yield_qty'] = (float) $row['yield_qty'];
        $row['lines'] = (new BomService())->lines($cmpId, [$id])[$id] ?? [];
        $row += self::previewFrom($row['lines']);
        $actors = $this->actorNames($cmpId, [$row['created_by'] ?? null, $row['updated_by'] ?? null]);
        $row['created_by_name'] = $actors[(string) ($row['created_by'] ?? '')] ?? null;
        $row['updated_by_name'] = $actors[(string) ($row['updated_by'] ?? '')] ?? null;

        return $row;
    }

    /**
     * Lines per BOM, split by kind, in one grouped query.
     *
     * @return array<int, array{total: int, component: int, by_product: int, scrap: int}>
     */
    private function lineCounts(int $cmpId, array $bomIds): array
    {
        $bomIds = array_values(array_filter($bomIds));
        if ($bomIds === []) {
            return [];
        }
        $out = [];
        foreach (array_chunk($bomIds, 500) as $chunk) {
            $rows = \Config\Database::connect()->table('inv_bom_lines')->select('bom_id, line_kind, COUNT(*) AS n')
                ->where('cmp_id', $cmpId)->whereIn('bom_id', $chunk)->groupBy(['bom_id', 'line_kind'])->get()->getResultArray();
            foreach ($rows as $r) {
                $bomId = (int) $r['bom_id'];
                $out[$bomId] ??= ['total' => 0, 'component' => 0, 'by_product' => 0, 'scrap' => 0];
                $n = (int) $r['n'];
                $out[$bomId]['total'] += $n;
                $kind = (string) $r['line_kind'];
                if (array_key_exists($kind, $out[$bomId])) {
                    $out[$bomId][$kind] += $n;
                }
            }
        }

        return $out;
    }

    /** @return array<string, mixed> */
    private function buildHeader(int $cmpId, array $body, ?array $existing): array
    {
        $name = trim((string) ($body['bom_name'] ?? ''));
        if ($name === '') {
            throw InventoryException::validation('bom_name is required', ['field' => 'bom_name']);
        }
        $finishedItemId = (int) ($body['finished_item_id'] ?? 0);
        if ($finishedItemId <= 0) {
            throw InventoryException::validation('finished_item_id is required', ['field' => 'finished_item_id']);
        }
        $yieldQty = (float) ($body['yield_qty'] ?? 1);
        if ($yieldQty <= 0) {
            throw InventoryException::validation('yield_qty must be greater than zero', ['field' => 'yield_qty']);
        }
        $items = $this->activeItems($cmpId, [$finishedItemId]);
        if (!isset($items[$finishedItemId])) {
            throw InventoryException::validation('Finished item #' . $finishedItemId . ' not found or inactive in this company', ['field' => 'finished_item_id', 'item_id' => $finishedItemId]);
        }
        $yieldUnitId = isset($body['yield_unit_id']) && (int) $body['yield_unit_id'] > 0 ? (int) $body['yield_unit_id'] : null;
        if ($yieldUnitId !== null && $this->validUnits($cmpId, [$yieldUnitId]) === []) {
            throw InventoryException::validation('yield_unit_id #' . $yieldUnitId . ' not found in this company', ['field' => 'yield_unit_id']);
        }
        $db = \Config\Database::connect();
        $dup = $db->table('inv_bom_headers')->where('cmp_id', $cmpId)->where('LOWER(bom_name)', mb_strtolower($name))->where('deleted_at', null);
        if ($existing) {
            $dup->where('bom_id !=', (int) $existing['bom_id']);
        }
        if ($dup->countAllResults() > 0) {
            throw InventoryException::conflict('Bill of materials "' . $name . '" already exists', ['field' => 'bom_name']);
        }

        return ['bom_name' => substr($name, 0, 255), 'finished_item_id' => $finishedItemId, 'yield_qty' => round($yieldQty, 4), 'yield_unit_id' => $yieldUnitId ?? (int) $items[$finishedItemId]['unit_id'] ?: null];
    }

    /**
     * @param list<array<string, mixed>> $raw
     * @return list<array<string, mixed>>
     */
    private function buildLines(int $cmpId, array $raw, int $finishedItemId): array
    {
        $lines = [];
        $sort = 0;
        foreach ($raw as $idx => $l) {
            if (!is_array($l)) {
                continue;
            }
            $itemId = (int) ($l['item_id'] ?? 0);
            if ($itemId <= 0) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': item_id is required', ['line' => $idx + 1]);
            }
            $qty = (float) ($l['qty'] ?? 0);
            if ($qty < 0) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': qty cannot be negative', ['line' => $idx + 1]);
            }
            $kind = strtolower(trim((string) ($l['line_kind'] ?? 'component'))) ?: 'component';
            if (!in_array($kind, BomService::LINE_KINDS, true)) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': line_kind must be one of ' . implode(', ', BomService::LINE_KINDS), ['line' => $idx + 1]);
            }
            if ($kind === 'component' && $itemId === $finishedItemId) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': the finished item cannot be its own component', ['line' => $idx + 1]);
            }
            $scrap = (float) ($l['scrap_percent'] ?? 0);
            if ($scrap < 0 || $scrap > 100) {
                throw InventoryException::validation('Line ' . ($idx + 1) . ': scrap_percent must be between 0 and 100', ['line' => $idx + 1]);
            }
            $lines[] = [
                'item_id'       => $itemId,
                'qty'           => round($qty, 4),
                'unit_id'       => isset($l['unit_id']) && (int) $l['unit_id'] > 0 ? (int) $l['unit_id'] : null,
                'line_kind'     => $kind,
                'scrap_percent' => round($scrap, 4),
                'sort_order'    => isset($l['sort_order']) && $l['sort_order'] !== '' ? (int) $l['sort_order'] : $sort,
            ];
            $sort++;
        }
        if ($lines === []) {
            throw InventoryException::validation('At least one component line is required', ['field' => 'lines']);
        }
        if (array_filter($lines, static fn ($l) => $l['line_kind'] === 'component' && $l['qty'] > 0) === []) {
            throw InventoryException::validation('At least one component line must have qty greater than zero', ['field' => 'lines']);
        }
        $itemIds = array_values(array_unique(array_column($lines, 'item_id')));
        $items = $this->activeItems($cmpId, $itemIds);
        $missing = array_values(array_diff($itemIds, array_keys($items)));
        if ($missing !== []) {
            throw InventoryException::validation('Component item(s) not found or inactive in this company: #' . implode(', #', $missing), ['field' => 'lines', 'item_ids' => $missing]);
        }
        $unitIds = array_values(array_unique(array_filter(array_column($lines, 'unit_id'))));
        if ($unitIds !== []) {
            $badUnits = array_values(array_diff($unitIds, $this->validUnits($cmpId, $unitIds)));
            if ($badUnits !== []) {
                throw InventoryException::validation('Unit(s) not found in this company: #' . implode(', #', $badUnits), ['field' => 'lines', 'unit_ids' => $badUnits]);
            }
        }
        foreach ($lines as &$l) {
            $l['unit_id'] ??= (int) $items[$l['item_id']]['unit_id'] ?: null;
        }

        return $lines;
    }

    /** @param list<array<string, mixed>> $lines */
    private function writeLines($db, int $cmpId, int $bomId, array $lines): void
    {
        $rows = array_map(static fn ($l) => $l + ['bom_id' => $bomId, 'cmp_id' => $cmpId], $lines);
        foreach (array_chunk($rows, 200) as $chunk) {
            $db->table('inv_bom_lines')->insertBatch($chunk);
        }
    }

    /** @return array<int, array<string, mixed>> live, active items keyed by id */
    private function activeItems(int $cmpId, array $itemIds): array
    {
        $itemIds = array_values(array_unique(array_filter(array_map('intval', $itemIds), static fn ($i) => $i > 0)));
        if ($itemIds === []) {
            return [];
        }
        $out = [];
        foreach (array_chunk($itemIds, 500) as $chunk) {
            $rows = \Config\Database::connect()->table('inv_items')->select('item_id, item_name, unit_id')->where('cmp_id', $cmpId)->where('deleted_at', null)->where('is_active', 1)->whereIn('item_id', $chunk)->get()->getResultArray();
            foreach ($rows as $r) {
                $out[(int) $r['item_id']] = $r;
            }
        }

        return $out;
    }

    /** @return list<int> unit ids that exist (live) in the company */
    private function validUnits(int $cmpId, array $unitIds): array
    {
        $unitIds = array_values(array_unique(array_filter(array_map('intval', $unitIds), static fn ($i) => $i > 0)));
        if ($unitIds === []) {
            return [];
        }
        $rows = \Config\Database::connect()->table('inv_uom')->select('unit_id')->where('cmp_id', $cmpId)->where('deleted_at', null)->whereIn('unit_id', $unitIds)->get()->getResultArray();

        return array_map(static fn ($r) => (int) $r['unit_id'], $rows);
    }
}
