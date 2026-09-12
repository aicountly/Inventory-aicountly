<?php

namespace App\Controllers\Api\V1;

class BrandsController extends MasterController
{
    protected string $table = 'inv_brands';
    protected string $pk = 'brand_id';
    protected string $nameColumn = 'brand_name';
    protected string $permissionBase = 'masters.brands';
    protected string $label = 'Brand';
    protected string $entityType = 'brand';
    protected array $columns = ['brand_alias'];
    protected array $required = ['brand_name'];
    protected array $deleteGuards = [['table' => 'inv_items', 'column' => 'brand_id', 'label' => 'item(s)']];
}
