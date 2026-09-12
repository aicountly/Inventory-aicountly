<?php

namespace App\Controllers\Api\V1;

class StockCategoriesController extends MasterController
{
    protected string $table = 'inv_stock_categories';
    protected string $pk = 'stock_cat_id';
    protected string $nameColumn = 'cat_name';
    protected string $permissionBase = 'masters.stock_categories';
    protected string $label = 'Stock Category';
    protected string $entityType = 'stock_category';
    protected array $columns = ['cat_alias'];
    protected array $required = ['cat_name'];
    protected array $searchColumns = ['cat_alias'];
    protected array $deleteGuards = [['table' => 'inv_items', 'column' => 'stock_cat_id', 'label' => 'item(s)']];
}
