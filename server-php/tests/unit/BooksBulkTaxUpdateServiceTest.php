<?php

namespace Tests\Unit;

use App\Services\BooksApiClient;
use App\Services\BooksBulkTaxUpdateService;
use PHPUnit\Framework\TestCase;

/**
 * BooksBulkTaxUpdateService is a thin, hard-scoped relay onto Books' Operations > Bulk Update
 * engine. These tests exercise the shaping it does before a call ever reaches BooksApiClient —
 * the target is always item_tax_category regardless of what a caller sends, company context
 * lands as query params, and a missing bearer token never reaches the network at all.
 *
 * @group unit
 */
final class BooksBulkTaxUpdateServiceTest extends TestCase
{
    public function testRecordsAlwaysTargetsItemTaxCategoryAndCarriesFilters(): void
    {
        $spy = $this->spyClient();
        $service = new BooksBulkTaxUpdateService($spy);

        $service->records(
            ['cmp_id' => 12, 'fy_id' => 3, 'bo_id' => 0],
            'ses-abc',
            ['q' => 'widget', 'page' => 2, 'per_page' => 50, 'stock_cat_id' => 7, 'tax_cat_id' => 9, 'hsn' => '8471'],
        );

        $this->assertSame('GET', $spy->calls[0]['method']);
        $this->assertStringContainsString('operations/bulk-update/records?', $spy->calls[0]['path']);
        parse_str(explode('?', $spy->calls[0]['path'], 2)[1], $params);
        $this->assertSame('item_tax_category', $params['target']);
        $this->assertSame('12', $params['cmp_id']);
        $this->assertSame('3', $params['fy_id']);
        $this->assertArrayNotHasKey('bo_id', $params, 'bo_id=0 must not be sent');
        $this->assertSame('widget', $params['q']);
        $this->assertSame('2', $params['page']);
        $this->assertSame('50', $params['per_page']);
        $this->assertSame('7', $params['stock_cat_id']);
        $this->assertSame('9', $params['tax_cat_id']);
        $this->assertSame('8471', $params['hsn']);
        $this->assertArrayNotHasKey('item_grp_id', $params, 'an absent filter must not be sent as 0');
        $this->assertSame(['Authorization: Bearer ses-abc'], $spy->calls[0]['extraHeaders']);
    }

    public function testApplyIgnoresACallerSuppliedTargetAndKeepsOnlyRowsAndEffectiveFrom(): void
    {
        $spy = $this->spyClient();
        $service = new BooksBulkTaxUpdateService($spy);

        $service->apply(
            ['cmp_id' => 12],
            'ses-abc',
            [
                'target'         => 'account_address',
                'rows'           => [['id' => 1, 'values' => ['tax_cat_id' => 5]]],
                'effective_from' => '2026-10-01',
                'unexpected'     => 'dropped',
            ],
        );

        $this->assertSame('POST', $spy->calls[0]['method']);
        $this->assertSame([
            'target'         => 'item_tax_category',
            'rows'           => [['id' => 1, 'values' => ['tax_cat_id' => 5]]],
            'effective_from' => '2026-10-01',
        ], $spy->calls[0]['body']);
    }

    public function testValidateOmitsEffectiveFromWhenNotSupplied(): void
    {
        $spy = $this->spyClient();
        $service = new BooksBulkTaxUpdateService($spy);

        $service->validate(['cmp_id' => 12], 'ses-abc', ['rows' => []]);

        $this->assertArrayNotHasKey('effective_from', $spy->calls[0]['body']);
    }

    public function testTaxCategoriesRequestsOnlyActiveItemEligibleOnes(): void
    {
        $spy = $this->spyClient();
        $service = new BooksBulkTaxUpdateService($spy);

        $service->taxCategories(['cmp_id' => 12], 'ses-abc');

        $this->assertSame('GET', $spy->calls[0]['method']);
        $this->assertStringContainsString('masters/tax-categories?', $spy->calls[0]['path']);
        parse_str(explode('?', $spy->calls[0]['path'], 2)[1], $params);
        $this->assertSame('1', $params['active_only']);
        $this->assertSame('1', $params['for_items']);
    }

    public function testMissingBearerIsRefusedWithoutReachingTheClient(): void
    {
        $spy = $this->spyClient();
        $service = new BooksBulkTaxUpdateService($spy);

        $res = $service->records(['cmp_id' => 12], '', []);

        $this->assertFalse($res['ok']);
        $this->assertSame(401, $res['status']);
        $this->assertCount(0, $spy->calls);
    }

    private function spyClient(): BooksApiClientSpy
    {
        return new BooksApiClientSpy();
    }
}

final class BooksApiClientSpy extends BooksApiClient
{
    /** @var list<array{method:string, path:string, body:?array, extraHeaders:array}> */
    public array $calls = [];

    public function __construct()
    {
    }

    public function request(string $method, string $path, ?array $body = null, array $extraHeaders = []): array
    {
        $this->calls[] = ['method' => $method, 'path' => $path, 'body' => $body, 'extraHeaders' => $extraHeaders];

        return ['ok' => true, 'status' => 200, 'body' => ['data' => []], 'error' => null];
    }
}
