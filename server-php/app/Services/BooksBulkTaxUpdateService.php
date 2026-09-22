<?php

namespace App\Services;

/**
 * Proxies Inventory's Items → Bulk Tax Rate Update screen to Books' own Operations → Bulk Update
 * engine, target `item_tax_category`.
 *
 * Books owns the tax rate: a `books_tax_categories` row and its with-effect-from history, plus
 * the write path that keeps voucher lines resolving statutory defaults by date. Inventory has no
 * rate of its own on `inv_items` — only an opaque `books_tax_cat_id` — so this screen collects
 * nothing Inventory would write itself. It hands the operator's own request to the master that
 * owns it, under the operator's own Books session: the `Authorization: Bearer <ses_key>` this
 * request already carries is the same portal-wide token Books validates on its own screens, so
 * Books' `masters.items.write` permission decides whether the change is allowed exactly as it
 * would from Books' own Operations → Bulk Update wizard — this proxy adds no authority of its
 * own beyond Inventory's local gate on reaching it at all.
 *
 * Hard-scoped to the `item_tax_category` target. This is deliberately NOT a general bulk-update
 * proxy: the target is never accepted from the caller, so no other Books master (accounts, or
 * item_hsn) becomes reachable through an Inventory route that has no local concept of it.
 */
class BooksBulkTaxUpdateService
{
    private const TARGET = 'item_tax_category';

    private BooksApiClient $client;

    public function __construct(?BooksApiClient $client = null)
    {
        $this->client = $client ?? new BooksApiClient();
    }

    /**
     * The tax categories the "current tax category" filter and the "new tax category" picker
     * both offer — Books' own master, since a category name and its rate_percent live nowhere
     * in Inventory. Requires the operator's Books session to also carry
     * `masters.tax_categories.read`; a caller with only `masters.items.write` sees Books' own
     * 403 for this one call, surfaced as-is rather than routed around.
     *
     * @param array<string, mixed> $ctx
     * @return array{ok:bool, status:int, body:?array, error:?string}
     */
    public function taxCategories(array $ctx, string $bearer): array
    {
        $params = array_merge($this->contextParams($ctx), [
            'active_only' => '1',
            'for_items'   => '1',
            'per_page'    => '500',
        ]);

        return $this->relayRequest('GET', 'masters/tax-categories?' . http_build_query($params), $bearer);
    }

    /**
     * @param array<string, mixed> $ctx {cmp_id, fy_id, bo_id}
     * @param array<string, mixed> $query
     * @return array{ok:bool, status:int, body:?array, error:?string}
     */
    public function records(array $ctx, string $bearer, array $query): array
    {
        $params = array_merge($this->contextParams($ctx), [
            'target'   => self::TARGET,
            'q'        => trim((string) ($query['q'] ?? '')),
            'page'     => (string) max(1, (int) ($query['page'] ?? 1)),
            'per_page' => (string) ($query['per_page'] ?? '25'),
        ]);
        foreach (['stock_cat_id', 'item_grp_id', 'tax_cat_id'] as $key) {
            $value = (int) ($query[$key] ?? 0);
            if ($value > 0) {
                $params[$key] = (string) $value;
            }
        }
        $hsn = trim((string) ($query['hsn'] ?? ''));
        if ($hsn !== '') {
            $params['hsn'] = $hsn;
        }

        return $this->relayRequest('GET', 'operations/bulk-update/records?' . http_build_query($params), $bearer);
    }

    /**
     * @param array<string, mixed> $ctx
     * @param array<string, mixed> $body {rows, effective_from?}
     * @return array{ok:bool, status:int, body:?array, error:?string}
     */
    public function validate(array $ctx, string $bearer, array $body): array
    {
        return $this->relayRequest(
            'POST',
            'operations/bulk-update/validate?' . http_build_query($this->contextParams($ctx)),
            $bearer,
            $this->batchBody($body),
        );
    }

    /**
     * @param array<string, mixed> $ctx
     * @param array<string, mixed> $body {rows, effective_from?}
     * @return array{ok:bool, status:int, body:?array, error:?string}
     */
    public function apply(array $ctx, string $bearer, array $body): array
    {
        return $this->relayRequest(
            'POST',
            'operations/bulk-update/apply?' . http_build_query($this->contextParams($ctx)),
            $bearer,
            $this->batchBody($body),
        );
    }

    /** @param array<string, mixed> $ctx */
    private function contextParams(array $ctx): array
    {
        $params = ['cmp_id' => (string) (int) ($ctx['cmp_id'] ?? 0)];
        if (!empty($ctx['fy_id'])) {
            $params['fy_id'] = (string) (int) $ctx['fy_id'];
        }
        if (!empty($ctx['bo_id'])) {
            $params['bo_id'] = (string) (int) $ctx['bo_id'];
        }

        return $params;
    }

    /** @param array<string, mixed> $body */
    private function batchBody(array $body): array
    {
        $out = [
            'target' => self::TARGET,
            'rows'   => is_array($body['rows'] ?? null) ? $body['rows'] : [],
        ];
        $effectiveFrom = trim((string) ($body['effective_from'] ?? ''));
        if ($effectiveFrom !== '') {
            $out['effective_from'] = $effectiveFrom;
        }

        return $out;
    }

    /** @return array{ok:bool, status:int, body:?array, error:?string} */
    private function relayRequest(string $method, string $path, string $bearer, ?array $body = null): array
    {
        if ($bearer === '') {
            return ['ok' => false, 'status' => 401, 'body' => null, 'error' => 'Missing Books session'];
        }

        return $this->client->request($method, $path, $body, ['Authorization: Bearer ' . $bearer]);
    }
}
