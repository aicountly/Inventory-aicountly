<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\InventoryReportService;
use Config\PermissionRegistry;

/**
 * /api/v1/reports/* — read-only inventory reports.
 *
 * Every action requires reports.<slug>.read (PermissionRegistry::REPORTS), is scoped to the
 * validated company context (cmp_id, fy_id; bo_id when > 0) and answers the standard list
 * envelope {data, meta:{total,limit,offset}, summary, filters}.
 *
 * Common query parameters: item_id, warehouse_id, item_grp_id, stock_cat_id, from / to /
 * as_of (YYYY-MM-DD), limit / offset / page, sort / order.
 */
class ReportsController extends BaseController
{
    protected InventoryReportService $reports;

    public function __construct()
    {
        parent::__construct();
        $this->reports = new InventoryReportService();
    }

    /** GET reports/stock-summary — opening / in / out / closing per item with unit cost and value. */
    public function stockSummary()
    {
        return $this->report('stock_summary', function (array $ctx, array $p) {
            $f = $this->commonFilters($p) + $this->dates(['from', 'to']) + ['nonzero' => $this->flag('nonzero', false)];

            return $this->reports->stockSummary((int) $ctx['cmp_id'], (int) $ctx['fy_id'], (int) $ctx['bo_id'], $f, $p['limit'], $p['offset']);
        }, 100, 1000, 'item_name');
    }

    /** GET reports/stock-ledger — one item's movements with running balance (item_id required). */
    public function stockLedger()
    {
        return $this->report('stock_ledger', function (array $ctx, array $p) {
            $itemId = (int) $this->request->getGet('item_id');
            if ($itemId <= 0) {
                return $this->failStructured(422, 'validation_failed', 'item_id is required', ['field' => 'item_id']);
            }
            $d = $this->dates(['from', 'to']);
            $r = $this->reports->itemLedger((int) $ctx['cmp_id'], (int) $ctx['fy_id'], (int) $ctx['bo_id'], $itemId, $this->int('warehouse_id'), $d['from'], $d['to'], $p['limit'], $p['offset'], $p['order']);
            $r['extra'] = ['item' => $r['item']];

            return $r;
        }, 100, 1000);
    }

    /** GET reports/warehouse-stock — closing qty and value per item per warehouse. */
    public function warehouseStock()
    {
        return $this->report('warehouse_stock', function (array $ctx, array $p) {
            $d = $this->dates(['to', 'as_of']);
            $f = $this->commonFilters($p) + ['to' => $d['to'] ?? $d['as_of'], 'nonzero' => $this->flag('nonzero', false)];

            return $this->reports->warehouseStock((int) $ctx['cmp_id'], (int) $ctx['fy_id'], (int) $ctx['bo_id'], $f, $p['limit'], $p['offset']);
        }, 100, 1000, 'item_name');
    }

    /** GET reports/batch-stock — balances by batch with expiry. */
    public function batchStock()
    {
        return $this->report('batch_stock', function (array $ctx, array $p) {
            $f = $this->commonFilters($p) + $this->dates(['expiring_before']) + [
                'batch_id'     => $this->int('batch_id'),
                'status'       => $this->csv('status'),
                'nonzero'      => $this->flag('nonzero', true),
                'by_warehouse' => $this->flag('by_warehouse', true),
            ];

            return $this->reports->batchStock((int) $ctx['cmp_id'], (int) $ctx['fy_id'], (int) $ctx['bo_id'], $f, $p['limit'], $p['offset']);
        }, 100, 1000, 'item_name');
    }

    /** GET reports/serial-stock — serial numbers by status / warehouse (status=all for every status). */
    public function serialStock()
    {
        return $this->report('serial_stock', function (array $ctx, array $p) {
            $f = $this->commonFilters($p) + [
                'batch_id'    => $this->int('batch_id'),
                'location_id' => $this->int('location_id'),
                'q'           => trim((string) ($this->request->getGet('q') ?? '')),
            ];
            $status = strtolower(trim((string) ($this->request->getGet('status') ?? '')));
            if ($status === 'all') {
                $f['status'] = null;
            } elseif ($status !== '') {
                $f['status'] = $this->csv('status');
            }

            return $this->reports->serialStock((int) $ctx['cmp_id'], (int) $ctx['fy_id'], (int) $ctx['bo_id'], $f, $p['limit'], $p['offset']);
        }, 100, 1000, 'item_name');
    }

    /** GET reports/stock-ageing — remaining cost layers in 0-30 / 31-60 / 61-90 / 91-180 / 180+ day buckets. */
    public function stockAgeing()
    {
        return $this->report('stock_ageing', function (array $ctx, array $p) {
            $f = $this->commonFilters($p) + $this->dates(['as_of']) + ['by_warehouse' => $this->flag('by_warehouse', false)];

            return $this->reports->stockAgeing((int) $ctx['cmp_id'], (int) $ctx['fy_id'], (int) $ctx['bo_id'], $f, $p['limit'], $p['offset']);
        }, 100, 1000, 'item_name');
    }

    /** GET reports/movement-analysis — fast / slow / non-moving / dead items. */
    public function movementAnalysis()
    {
        return $this->report('movement_analysis', function (array $ctx, array $p) {
            $f = $this->commonFilters($p) + $this->dates(['from', 'to']) + [
                'fast_days'        => $this->int('fast_days') ?? 30,
                'slow_days'        => $this->int('slow_days') ?? 90,
                'dead_days'        => $this->int('dead_days') ?? 180,
                'class'            => strtolower(trim((string) ($this->request->getGet('class') ?? $this->request->getGet('classification') ?? ''))) ?: null,
                'include_inactive' => $this->flag('include_inactive', false),
            ];

            return $this->reports->movementAnalysis((int) $ctx['cmp_id'], (int) $ctx['fy_id'], (int) $ctx['bo_id'], $f, $p['limit'], $p['offset']);
        }, 100, 1000, 'item_name');
    }

    /** GET reports/near-expiry — batches with on-hand stock expiring within `days` (default 30). */
    public function nearExpiry()
    {
        return $this->report('near_expiry', function (array $ctx, array $p) {
            $f = $this->commonFilters($p) + $this->dates(['as_of']) + [
                'days'            => $this->int('days') ?? 30,
                'include_expired' => $this->flag('include_expired', true),
                'by_warehouse'    => $this->flag('by_warehouse', false),
            ];

            return $this->reports->nearExpiry((int) $ctx['cmp_id'], (int) $ctx['fy_id'], (int) $ctx['bo_id'], $f, $p['limit'], $p['offset']);
        }, 100, 1000, 'expiry_date');
    }

    /** GET reports/replenishment and GET replenishment — reorder advice per item. */
    public function replenishment()
    {
        return $this->report('replenishment', function (array $ctx, array $p) {
            $f = $this->commonFilters($p) + [
                'only_triggered'       => $this->flag('only_triggered', true),
                'with_thresholds_only' => $this->flag('with_thresholds_only', $this->flag('only_triggered', true)),
            ];

            return $this->reports->replenishment((int) $ctx['cmp_id'], (int) $ctx['fy_id'], (int) $ctx['bo_id'], $f, $p['limit'], $p['offset']);
        }, 100, 1000, 'item_name');
    }

    // ------------------------------------------------------------------ plumbing

    /**
     * authorize reports.<slug>.read, run the report, answer the list envelope. The callable gets
     * (ctx, listParams) and returns {rows, total, summary[, extra]} or a ready response.
     */
    private function report(string $slug, callable $fn, int $defaultLimit = 100, int $maxLimit = 1000, string $defaultSort = '')
    {
        if (!isset(PermissionRegistry::REPORTS[$slug])) {
            return $this->failStructured(500, 'internal_error', 'Unknown report ' . $slug);
        }
        $a = $this->authorize('reports.' . $slug . '.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $p = $this->listParams($defaultLimit, $maxLimit, $defaultSort);
        try {
            $r = $fn($a['ctx'], $p);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
        if (!is_array($r)) {
            return $r; // an error response built by the callable (validation)
        }
        $extra = ['summary' => $r['summary'] ?? [], 'report' => $slug];
        if (isset($r['extra']) && is_array($r['extra'])) {
            $extra += $r['extra'];
        }

        return $this->respondList(array_values($r['rows'] ?? []), (int) ($r['total'] ?? 0), $p['limit'], $p['offset'], $extra);
    }

    /** @return array{item_id:?int, warehouse_id:?int, item_grp_id:?int, stock_cat_id:?int, sort:string, order:string} */
    private function commonFilters(array $p): array
    {
        return [
            'item_id'      => $this->int('item_id'),
            'warehouse_id' => $this->int('warehouse_id'),
            'item_grp_id'  => $this->int('item_grp_id'),
            'stock_cat_id' => $this->int('stock_cat_id'),
            'sort'         => $p['sort'],
            'order'        => $p['order'],
        ];
    }

    private function int(string $key): ?int
    {
        $v = $this->request->getGet($key);
        if ($v === null || $v === '') {
            return null;
        }

        return (int) $v;
    }

    private function flag(string $key, bool $default): bool
    {
        $v = $this->request->getGet($key);
        if ($v === null || $v === '') {
            return $default;
        }

        return in_array(strtolower((string) $v), ['1', 'true', 'yes', 'on'], true);
    }

    /** @return list<string>|null */
    private function csv(string $key): ?array
    {
        $v = trim((string) ($this->request->getGet($key) ?? ''));
        if ($v === '') {
            return null;
        }
        $parts = array_values(array_filter(array_map(static fn ($s) => strtolower(trim($s)), explode(',', $v)), static fn ($s) => $s !== ''));

        return $parts !== [] ? $parts : null;
    }

    /**
     * Read YYYY-MM-DD query params; a malformed one throws a validation exception the report()
     * wrapper turns into a 422.
     *
     * @param list<string> $keys
     * @return array<string, ?string>
     */
    private function dates(array $keys): array
    {
        $out = [];
        foreach ($keys as $key) {
            $v = trim((string) ($this->request->getGet($key) ?? ''));
            if ($v === '') {
                $out[$key] = null;
                continue;
            }
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) || !checkdate((int) substr($v, 5, 2), (int) substr($v, 8, 2), (int) substr($v, 0, 4))) {
                throw \App\Exceptions\InventoryException::validation($key . ' must be YYYY-MM-DD', ['field' => $key]);
            }
            $out[$key] = $v;
        }

        return $out;
    }
}
