<?php

namespace App\Services;

/**
 * Per-brand sales for the selected company / FY / branch, read LIVE from Books.
 *
 * Why this class exists at all, and what it must never become.
 *
 * A brand's turnover is a commercial figure. Books owns it: it owns the invoices the figure is
 * summed from, the credit notes that reduce it and the FY the sum belongs to. Inventory owns the
 * brand master and the item that carries the brand, and nothing else about it. The Brands screen
 * shows both side by side, so somebody has to join them — and the join happens HERE, in one
 * request, at the moment the screen asks, against Books' own live endpoint.
 *
 * It is explicitly NOT done by copying Books' numbers into an inv_* table on a schedule. A
 * `inv_brand_sales` table fed by a cron would be a second copy of another product's ledger: wrong
 * within a minute of a back-dated credit note, impossible to reconcile, and a second place for the
 * same truth to live. There is no such table and this service creates none — it holds nothing, it
 * asks.
 *
 * ## The contract awaited from Books
 *
 * `GET /api/integration/inventory/brand-sales?cmp_id=&fy_id=&bo_id=`, authenticated with the same
 * shared service key as every other Inventory→Books call, answering:
 *
 *     {"data": {"currency": "INR",
 *               "rows": [{"brand_id": 41, "sales": 1245670.50, "trend": [11,13,9,14,18,21]}]}}
 *
 * `brand_id` is Inventory's own brand id, which Books already carries on the item lines Inventory
 * hands it. `trend` is optional and is a plain series for a sparkline — omit it rather than send a
 * flat line. A brand with no sales in the period is omitted, not sent as zero: absent and zero are
 * different answers and the screen renders them differently.
 *
 * Until Books serves that path this returns `available = false` with a reason, and the screen shows
 * the brand master without a sales column. It never guesses, and it never rounds a missing number
 * down to zero.
 */
class BrandSalesService
{
    /**
     * Off by default, and deliberately so.
     *
     * Books does not serve the path yet. Calling it on every Brands page load would spend a
     * connect timeout per view to learn the same 404 each time — the caller pays, the screen waits,
     * and nothing is learned. The flag is the switch that is thrown once the Books side ships.
     */
    public function enabled(): bool
    {
        $raw = getenv('BOOKS_BRAND_SALES');

        return $raw !== false && in_array(strtolower(trim((string) $raw)), ['1', 'true', 'yes', 'on'], true);
    }

    /**
     * @return array{available:bool, reason:?string, currency:?string, rows:list<array{brand_id:int, sales:float, trend:?list<float>}>}
     */
    public function fetch(int $cmpId, int $fyId, int $boId): array
    {
        if (!$this->enabled()) {
            return $this->unavailable('not_configured');
        }

        $res = (new BooksApiClient())->request(
            'GET',
            'integration/inventory/brand-sales?cmp_id=' . $cmpId . '&fy_id=' . $fyId . '&bo_id=' . $boId,
        );

        if (!$res['ok']) {
            // A 404 means the Books side has not shipped the endpoint; anything else means it has
            // and is unwell. The screen words those differently, so they are not flattened here.
            return $this->unavailable($res['status'] === 404 ? 'not_implemented' : 'unavailable');
        }

        $payload = $res['body']['data'] ?? $res['body'] ?? [];
        $rows = [];
        foreach ((array) ($payload['rows'] ?? []) as $row) {
            $brandId = (int) ($row['brand_id'] ?? 0);
            if ($brandId <= 0 || !isset($row['sales']) || !is_numeric($row['sales'])) {
                continue;
            }
            $trend = null;
            if (isset($row['trend']) && is_array($row['trend'])) {
                $points = array_values(array_map('floatval', array_filter($row['trend'], 'is_numeric')));
                // One point is not a trend, and a chart drawn from it is a decoration.
                $trend = count($points) >= 2 ? $points : null;
            }
            $rows[] = ['brand_id' => $brandId, 'sales' => (float) $row['sales'], 'trend' => $trend];
        }

        $currency = $payload['currency'] ?? null;

        return [
            'available' => true,
            'reason'    => null,
            'currency'  => is_string($currency) && $currency !== '' ? strtoupper($currency) : null,
            'rows'      => $rows,
        ];
    }

    /** @return array{available:bool, reason:?string, currency:?string, rows:list<array{brand_id:int, sales:float, trend:?list<float>}>} */
    private function unavailable(string $reason): array
    {
        return ['available' => false, 'reason' => $reason, 'currency' => null, 'rows' => []];
    }
}
