<?php

namespace App\Controllers\Api\V1;

class WarehouseGroupsController extends MasterController
{
    protected string $table = 'inv_warehouse_groups';
    protected string $pk = 'warehouse_group_id';
    protected string $nameColumn = 'grp_name';
    protected string $permissionBase = 'masters.warehouse_groups';
    protected string $label = 'Warehouse Group';
    protected string $entityType = 'warehouse_group';
    protected array $columns = ['parent_grp_id'];
    protected array $required = ['grp_name'];
    protected ?string $parentColumn = 'parent_grp_id';
    protected array $deleteGuards = [['table' => 'inv_warehouses', 'column' => 'warehouse_group_id', 'label' => 'warehouse(s)']];
}
