<?php

namespace App\Controllers\Api\V1;

class UomController extends MasterController
{
    protected string $table = 'inv_uom';
    protected string $pk = 'unit_id';
    protected string $nameColumn = 'unit_name';
    protected string $permissionBase = 'masters.uom';
    protected string $label = 'Unit';
    protected string $entityType = 'uom';
    protected array $columns = ['unit_symbol', 'print_name', 'uqc_gst', 'decimal_places'];
    protected array $required = ['unit_name', 'unit_symbol'];
    protected array $searchColumns = ['unit_symbol', 'uqc_gst'];
    protected array $deleteGuards = [['table' => 'inv_items', 'column' => 'unit_id', 'label' => 'item(s)'], ['table' => 'inv_item_uoms', 'column' => 'unit_id', 'label' => 'item unit line(s)']];

    protected function buildRow(int $cmpId, array $body, ?array $existing): array
    {
        $row = parent::buildRow($cmpId, $body, $existing);
        $row['print_name'] = $row['print_name'] ?? $row['unit_symbol'] ?? null;
        $row['decimal_places'] = isset($row['decimal_places']) ? max(0, min(4, (int) $row['decimal_places'])) : 4;

        return $row;
    }
}
