<?php

namespace App\Controllers\Api\V1;

use App\Exceptions\InventoryException;

class WarehousesController extends MasterController
{
    protected string $table = 'inv_warehouses';
    protected string $pk = 'warehouse_id';
    protected string $nameColumn = 'warehouse_name';
    protected string $permissionBase = 'masters.warehouses';
    protected string $label = 'Warehouse';
    protected string $entityType = 'warehouse';
    protected array $columns = ['warehouse_code', 'warehouse_group_id', 'parent_warehouse_id', 'warehouse_type', 'is_default', 'allow_negative', 'address_json', 'contact_json', 'bo_id'];
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
