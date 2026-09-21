<?php

namespace App\Controllers\Api\V1;

use App\Exceptions\InventoryException;

class WarehousesController extends MasterController
{
    /**
     * Floor-area units a warehouse may be measured in.
     *
     * Stored beside the number rather than normalised to one canonical unit: sq ft and sq m are
     * both in daily use in India, and converting on write would show the user back a figure they
     * did not type. The vocabulary is enforced here, not by a CHECK constraint, so a bad value
     * comes back as a 422 naming the field and the form can attach it to the input.
     *
     * @var list<string>
     */
    public const AREA_UNITS = ['sq_ft', 'sq_m', 'sq_yd', 'acre', 'hectare'];

    protected string $table = 'inv_warehouses';
    protected string $pk = 'warehouse_id';
    protected string $nameColumn = 'warehouse_name';
    protected string $permissionBase = 'masters.warehouses';
    protected string $label = 'Warehouse';
    protected string $entityType = 'warehouse';
    protected ?string $mirrorKind = 'warehouse';
    protected array $columns = ['warehouse_code', 'warehouse_group_id', 'parent_warehouse_id', 'warehouse_type', 'is_default', 'allow_negative', 'address_json', 'contact_json', 'bo_id', 'capacity_units', 'area', 'area_unit', 'latitude', 'longitude'];
    protected array $required = ['warehouse_name'];
    protected array $searchColumns = ['warehouse_code'];
    protected ?string $parentColumn = 'parent_warehouse_id';
    protected array $deleteGuards = [
        ['table' => 'inv_document_lines', 'column' => 'warehouse_id', 'label' => 'document line(s)'],
        ['table' => 'inv_stock_movements', 'column' => 'warehouse_id', 'label' => 'stock movement(s)'],
    ];

    protected function applyIndexFilters($builder): void
    {
        if ($t = $this->request->getGet('warehouse_type')) {
            $builder->where('warehouse_type', $t);
        }
        if (($bo = $this->request->getGet('bo_id')) !== null && $bo !== '' && (int) $bo > 0) {
            $builder->groupStart()->where('bo_id', (int) $bo)->orWhere('bo_id', 0)->groupEnd();
        }
    }

    /**
     * GET warehouses/summary — the company's warehouse totals, computed in the database.
     *
     * The list is paged, and a KPI strip that added up the fifty rows on screen would report
     * "Total capacity" for page 1 of 9 and call it the company's. These aggregates run over every
     * warehouse the caller can see, in four grouped queries, so the figures above the table are
     * the company's however the table beneath them is filtered or paged.
     *
     * Branch scope is the list's: with a branch selected, a warehouse belonging to that branch or
     * shared by all of them (bo_id = 0). Search, status and type filters are deliberately NOT
     * applied — the cards answer "how many warehouses does this company have", which does not
     * change because the user typed into the search box.
     *
     * Capacity sums only what is configured and says how many rows that was (`configured`), so the
     * UI can tell "50,000 units across 8 of 12 warehouses" from "nothing configured yet" and show
     * "Not configured" rather than a utilisation against an invented denominator.
     */
    public function summary()
    {
        $a = $this->authorize($this->permissionBase . '.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }

        return $this->respond(['data' => $this->summaryFor(
            (int) $a['ctx']['cmp_id'],
            (int) ($this->request->getGet('bo_id') ?? 0),
        )]);
    }

    /**
     * The aggregates behind `summary()`, without the HTTP wrapper.
     *
     * Split out so the SQL can be driven directly by an integration test against
     * real PostgreSQL: `COUNT(*) FILTER`, `address_json->>'city'` grouping and
     * the difference between `SUM` over no rows and `SUM` over nulls are exactly
     * the things a stubbed database would get wrong.
     *
     * @return array<string, mixed>
     */
    protected function summaryFor(int $cmpId, int $bo = 0): array
    {
        $db = \Config\Database::connect();

        $where = 'cmp_id = ? AND deleted_at IS NULL';
        $binds = [$cmpId];
        if ($bo > 0) {
            $where .= ' AND (bo_id = ? OR bo_id = 0)';
            $binds[] = $bo;
        }

        $totals = $db->query(
            'SELECT COUNT(*) AS total,'
            . ' COUNT(*) FILTER (WHERE is_active = 1) AS active,'
            . ' COUNT(*) FILTER (WHERE is_active <> 1) AS inactive,'
            . ' COUNT(*) FILTER (WHERE is_default = 1) AS defaults,'
            . ' COALESCE(SUM(capacity_units), 0) AS capacity_units,'
            . ' COUNT(capacity_units) AS capacity_configured,'
            . ' COALESCE(SUM(area), 0) AS area,'
            . ' COUNT(area) AS area_configured,'
            . ' COUNT(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL) AS with_coordinates'
            . ' FROM ' . $this->table . ' WHERE ' . $where,
            $binds
        )->getRowArray() ?: [];

        $byType = $db->query(
            'SELECT warehouse_type, COUNT(*) AS count, COUNT(*) FILTER (WHERE is_active = 1) AS active'
            . ' FROM ' . $this->table . ' WHERE ' . $where
            . ' GROUP BY warehouse_type ORDER BY COUNT(*) DESC, warehouse_type ASC',
            $binds
        )->getResultArray();

        // Country > state > city, from the postal address the user typed. Rows with no address at
        // all collapse into one group with empty strings, which the UI labels "No location set" —
        // it does not invent a city for them.
        $byLocation = $db->query(
            "SELECT COALESCE(NULLIF(BTRIM(address_json->>'country'), ''), '') AS country,"
            . " COALESCE(NULLIF(BTRIM(address_json->>'state'), ''), '') AS state,"
            . " COALESCE(NULLIF(BTRIM(address_json->>'city'), ''), '') AS city,"
            . ' COUNT(*) AS count, COUNT(*) FILTER (WHERE is_active = 1) AS active'
            . ' FROM ' . $this->table . ' WHERE ' . $where
            . ' GROUP BY 1, 2, 3 ORDER BY COUNT(*) DESC, 1 ASC, 2 ASC, 3 ASC',
            $binds
        )->getResultArray();

        // Area is summed per unit, never across them: adding hectares to square feet would produce
        // a number that is true of nothing.
        $areaByUnit = $db->query(
            "SELECT COALESCE(NULLIF(BTRIM(area_unit), ''), 'sq_ft') AS unit, COALESCE(SUM(area), 0) AS area, COUNT(*) AS count"
            . ' FROM ' . $this->table . ' WHERE ' . $where . ' AND area IS NOT NULL'
            . ' GROUP BY 1 ORDER BY SUM(area) DESC',
            $binds
        )->getResultArray();

        $capacityUnits = (float) ($totals['capacity_units'] ?? 0);
        $capacityConfigured = (int) ($totals['capacity_configured'] ?? 0);

        return [
            'total'    => (int) ($totals['total'] ?? 0),
            'active'   => (int) ($totals['active'] ?? 0),
            'inactive' => (int) ($totals['inactive'] ?? 0),
            'defaults' => (int) ($totals['defaults'] ?? 0),
            'capacity' => [
                // null, not 0: no warehouse has a capacity, so the company has no ceiling to report
                // and every screen downstream must say "Not configured" instead of dividing by it.
                'units'           => $capacityConfigured > 0 ? $capacityUnits : null,
                'configured'      => $capacityConfigured,
                'area'            => (int) ($totals['area_configured'] ?? 0) > 0 ? (float) ($totals['area'] ?? 0) : null,
                'area_configured' => (int) ($totals['area_configured'] ?? 0),
                'area_by_unit'    => array_map(static fn (array $r): array => [
                    'unit'  => (string) $r['unit'],
                    'area'  => (float) $r['area'],
                    'count' => (int) $r['count'],
                ], $areaByUnit),
            ],
            'geo' => [
                'with_coordinates' => (int) ($totals['with_coordinates'] ?? 0),
            ],
            'by_type' => array_map(static fn (array $r): array => [
                'warehouse_type' => (string) $r['warehouse_type'],
                'count'          => (int) $r['count'],
                'active'         => (int) $r['active'],
            ], $byType),
            'by_location' => array_map(static fn (array $r): array => [
                'country' => (string) $r['country'],
                'state'   => (string) $r['state'],
                'city'    => (string) $r['city'],
                'count'   => (int) $r['count'],
                'active'  => (int) $r['active'],
            ], $byLocation),
        ];
    }

    protected function buildRow(int $cmpId, array $body, ?array $existing): array
    {
        $row = parent::buildRow($cmpId, $body, $existing);
        $types = ['standard', 'transit', 'damaged', 'quarantine', 'consignment', 'job_worker', 'virtual'];
        $type = strtolower(trim((string) ($row['warehouse_type'] ?? ($existing['warehouse_type'] ?? 'standard'))));
        $row['warehouse_type'] = in_array($type, $types, true) ? $type : 'standard';
        $row['is_default'] = !empty($row['is_default']) ? 1 : 0;
        $row['allow_negative'] = isset($row['allow_negative']) && $row['allow_negative'] !== null ? (!empty($row['allow_negative']) ? 1 : 0) : null;
        $row['bo_id'] = isset($row['bo_id']) ? (int) $row['bo_id'] : ($existing['bo_id'] ?? 0);
        foreach (['address_json' => 'address', 'contact_json' => 'contact'] as $col => $key) {
            if (isset($body[$key]) && is_array($body[$key])) {
                $row[$col] = json_encode($body[$key]);
            } elseif (isset($row[$col]) && is_array($row[$col])) {
                $row[$col] = json_encode($row[$col]);
            }
        }

        // Capacity and geography: every one of these is optional, and "not set" is a real answer
        // the screens render as "Not configured". So a blank clears the column rather than being
        // coerced to 0 — a warehouse with a 0-unit ceiling would read as permanently 100% full.
        foreach (['capacity_units', 'area'] as $col) {
            if (!array_key_exists($col, $row)) {
                continue;
            }
            if ($row[$col] === null || $row[$col] === '') {
                $row[$col] = null;
                continue;
            }
            if (!is_numeric($row[$col])) {
                throw InventoryException::validation(($col === 'area' ? 'Area' : 'Capacity') . ' must be a number', ['field' => $col]);
            }
            if ((float) $row[$col] < 0) {
                throw InventoryException::validation(($col === 'area' ? 'Area' : 'Capacity') . ' cannot be negative', ['field' => $col]);
            }
            $row[$col] = (float) $row[$col];
        }
        if (array_key_exists('area_unit', $row)) {
            $unit = strtolower(trim((string) ($row['area_unit'] ?? '')));
            if ($unit === '') {
                $row['area_unit'] = null;
            } elseif (!in_array($unit, self::AREA_UNITS, true)) {
                throw InventoryException::validation('Unknown area unit', ['field' => 'area_unit', 'allowed' => self::AREA_UNITS]);
            } else {
                $row['area_unit'] = $unit;
            }
        }
        // An area without a unit is a number nobody can read. Default it rather than refuse the
        // save: the user typed the figure, and sq ft is what an Indian warehouse is quoted in.
        if (!empty($row['area']) && empty($row['area_unit']) && empty($existing['area_unit'])) {
            $row['area_unit'] = 'sq_ft';
        }
        foreach (['latitude' => 90.0, 'longitude' => 180.0] as $col => $limit) {
            if (!array_key_exists($col, $row)) {
                continue;
            }
            if ($row[$col] === null || $row[$col] === '') {
                $row[$col] = null;
                continue;
            }
            if (!is_numeric($row[$col])) {
                throw InventoryException::validation(ucfirst($col) . ' must be a number', ['field' => $col]);
            }
            $value = (float) $row[$col];
            if ($value < -$limit || $value > $limit) {
                throw InventoryException::validation(ucfirst($col) . ' must be between -' . $limit . ' and ' . $limit, ['field' => $col]);
            }
            $row[$col] = $value;
        }
        // A point needs both halves. Half a coordinate plots nothing, and silently keeping it would
        // leave the map explaining why a warehouse with a "latitude" is missing from it.
        $lat = array_key_exists('latitude', $row) ? $row['latitude'] : ($existing['latitude'] ?? null);
        $lng = array_key_exists('longitude', $row) ? $row['longitude'] : ($existing['longitude'] ?? null);
        if (($lat === null) !== ($lng === null)) {
            throw InventoryException::validation('Latitude and longitude must be set together', ['field' => $lat === null ? 'latitude' : 'longitude']);
        }

        if (!empty($row['warehouse_code'])) {
            $b = \Config\Database::connect()->table($this->table)->where('cmp_id', $cmpId)->where('warehouse_code', $row['warehouse_code'])->where('deleted_at', null);
            if ($existing) {
                $b->where('warehouse_id !=', (int) $existing['warehouse_id']);
            }
            if ($b->countAllResults() > 0) {
                throw InventoryException::conflict('Warehouse code already in use', ['field' => 'warehouse_code']);
            }
        }

        return $row;
    }

    protected function afterSave(int $cmpId, int $id, array $body, ?string $actor, bool $isNew): void
    {
        if (!empty($body['is_default'])) {
            \Config\Database::connect()->table($this->table)->where('cmp_id', $cmpId)->where('warehouse_id !=', $id)->update(['is_default' => 0]);
        }
    }
}
