<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\RegisterSummaryService;

/**
 * The registers hub.
 *
 *   GET /api/v1/registers/summary   counters for the strip above the register list
 *
 * There is no `GET /v1/registers`: the list of registers is a client-side
 * catalogue (web/src/registers/configs), every entry of which is already a
 * route the server serves on its own. An endpoint that re-listed them would be
 * a second copy of that catalogue, free to drift from the first.
 *
 * The hub itself never depends on this call. A reader whose strip fails to load
 * still opens every register on the page — see RegistersHubPage, which drops
 * the strip and renders the sections regardless.
 */
class RegistersController extends BaseController
{
    /**
     * GET /api/v1/registers/summary
     *
     * Company, financial year and branch come from the authorised session
     * context, never from a query parameter, exactly as the dashboard does.
     * The caller passes no date: "as on" is the server's own day, pulled back
     * to the selected year's close when that year has already ended, so a
     * reader browsing FY 2024-25 is not told the books are as at this morning.
     *
     * Each figure is gated on the permission of the register it summarises and
     * answers null when the caller does not hold it. A null is not an error:
     * the strip prints an em dash for it and the registers stay open.
     */
    public function summary()
    {
        $a = $this->authorize('inventory.enter');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $session = $a['session'];
        $cmpId = (int) $ctx['cmp_id'];
        $uuid = (string) ($session['uuid'] ?? '');

        $may = function (string $permission) use ($uuid, $cmpId, $session): bool {
            return $this->access->hasPermission($uuid, $cmpId, $permission, $session);
        };

        try {
            $data = (new RegisterSummaryService())->summary(
                $cmpId,
                (int) $ctx['fy_id'],
                (int) $ctx['bo_id'],
                date('Y-m-d'),
                [
                    'items'      => $may('masters.items.read'),
                    'warehouses' => $may('masters.warehouses.read'),
                    'locations'  => $may('masters.locations.read'),
                    'movements'  => $may('reports.stock_ledger.read'),
                    // The value is the one the reconciliation run recorded, so
                    // it is the reconciliation register's permission that
                    // governs it — not valuation's, which would promise a live
                    // figure this endpoint deliberately does not compute.
                    'stock_value' => $may('reconciliation.read'),
                ],
            );
        } catch (\Throwable $e) {
            log_message('error', 'registers summary failed: ' . $e->getMessage());

            return $this->failStructured(500, 'query_failed', 'Could not read the register counters for this company');
        }

        return $this->respond(['data' => $data]);
    }
}
