<?php

namespace App\Controllers\Api\V1;

class ItemGroupsController extends MasterController
{
    protected string $table = 'inv_item_groups';
    protected string $pk = 'item_grp_id';
    protected string $nameColumn = 'grp_name';
    protected string $permissionBase = 'masters.item_groups';
    protected string $label = 'Item Group';
    protected string $entityType = 'item_group';
    protected array $columns = ['grp_alias', 'parent_grp_id', 'is_primary'];
    protected array $required = ['grp_name'];
    protected array $searchColumns = ['grp_alias'];
    protected ?string $parentColumn = 'parent_grp_id';
    protected array $deleteGuards = [['table' => 'inv_items', 'column' => 'item_grp_id', 'label' => 'item(s)']];

    protected function buildRow(int $cmpId, array $body, ?array $existing): array
    {
        $row = parent::buildRow($cmpId, $body, $existing);
        // On update $body is existing+request merged; a request that sets a parent without saying
        // is_primary means "make this a child group", so the stale is_primary=1 must not win.
        $raw = $this->request->getJSON(true) ?? [];
        if ($existing && array_key_exists('parent_grp_id', $raw) && !array_key_exists('is_primary', $raw)) {
            $row['is_primary'] = empty($raw['parent_grp_id']) ? 1 : 0;
        }
        $row['is_primary'] = !empty($row['is_primary']) ? 1 : 0;
        if ($row['is_primary'] === 1) {
            $row['parent_grp_id'] = null;
        } elseif (empty($row['parent_grp_id'])) {
            $row['parent_grp_id'] = null;
            $row['is_primary'] = 1;
        } else {
            $row['parent_grp_id'] = (int) $row['parent_grp_id'];
        }

        return $row;
    }

    /** item_count for the whole page with one grouped query (no per-row COUNT). */
    protected function decorateRows(int $cmpId, array $rows): array
    {
        $ids = array_values(array_unique(array_map(static fn ($r) => (int) $r['item_grp_id'], $rows)));
        $counts = [];
        foreach (array_chunk($ids, 500) as $chunk) {
            $res = \Config\Database::connect()->table('inv_items')->select('item_grp_id, COUNT(*) AS n')
                ->where('cmp_id', $cmpId)->where('deleted_at', null)->whereIn('item_grp_id', $chunk)->groupBy('item_grp_id')->get()->getResultArray();
            foreach ($res as $r) {
                $counts[(int) $r['item_grp_id']] = (int) $r['n'];
            }
        }
        foreach ($rows as &$row) {
            $row['item_count'] = $counts[(int) $row['item_grp_id']] ?? 0;
        }

        return $rows;
    }
}
