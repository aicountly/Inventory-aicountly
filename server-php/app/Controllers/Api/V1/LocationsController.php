<?php

namespace App\Controllers\Api\V1;

use App\Exceptions\InventoryException;

class LocationsController extends MasterController
{
    protected string $table = 'inv_locations';
    protected string $pk = 'location_id';
    protected string $nameColumn = 'location_code';
    protected string $permissionBase = 'masters.locations';
    protected string $label = 'Location';
    protected string $entityType = 'location';
    protected array $columns = ['warehouse_id', 'parent_location_id', 'location_name', 'location_type'];
    protected array $required = ['location_code', 'warehouse_id'];
    protected array $searchColumns = ['location_name'];
    protected ?string $parentColumn = 'parent_location_id';
    protected array $deleteGuards = [['table' => 'inv_document_lines', 'column' => 'location_id', 'label' => 'document line(s)']];

    protected function applyIndexFilters($builder): void
    {
        if ($wh = (int) $this->request->getGet('warehouse_id')) {
            $builder->where('warehouse_id', $wh);
        }
    }

    /** location_code is unique per warehouse (not company-wide); parent checks stay in MasterController::validateParent. */
    protected function validateUnique(int $cmpId, array $row, ?array $existing): void
    {
        $b = \Config\Database::connect()->table($this->table)->where('cmp_id', $cmpId)->where('warehouse_id', (int) $row['warehouse_id'])->where('location_code', $row['location_code'])->where('deleted_at', null);
        if ($existing) {
            $b->where('location_id !=', (int) $existing['location_id']);
        }
        if ($b->countAllResults() > 0) {
            throw InventoryException::conflict('Location code already exists in this warehouse');
        }
    }

    protected function buildRow(int $cmpId, array $body, ?array $existing): array
    {
        $row = parent::buildRow($cmpId, $body, $existing);
        $row['warehouse_id'] = (int) $row['warehouse_id'];
        if ($row['warehouse_id'] <= 0 || \Config\Database::connect()->table('inv_warehouses')->where('cmp_id', $cmpId)->where('warehouse_id', $row['warehouse_id'])->where('deleted_at', null)->countAllResults() === 0) {
            throw InventoryException::validation('Warehouse #' . $row['warehouse_id'] . ' not found in this company', ['field' => 'warehouse_id']);
        }
        $type = strtolower(trim((string) ($row['location_type'] ?? ($existing['location_type'] ?? 'bin'))));
        $row['location_type'] = in_array($type, ['zone', 'rack', 'shelf', 'bin'], true) ? $type : 'bin';

        return $row;
    }
}
