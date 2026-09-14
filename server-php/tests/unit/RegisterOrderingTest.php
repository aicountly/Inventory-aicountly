<?php

namespace Tests\Unit;

use App\Controllers\Api\V1\ValuationController;
use App\Services\PendingQuantityService;
use PHPUnit\Framework\TestCase;

/**
 * A sort header that does nothing is worse than no sort header: the arrow moves, the rows come
 * back in the order they were already in, and the reader believes the top row is the largest.
 *
 * The valuation snapshot and the pending register are both assembled in PHP (their key columns
 * are derived), so their ordering is asserted here directly.
 *
 * @group unit
 */
final class RegisterOrderingTest extends TestCase
{
    private const SNAPSHOT = [
        ['item_id' => 3, 'item_name' => 'Copper rod', 'closing_qty' => 5.0, 'unit_cost' => 90.0, 'stock_value' => 450.0],
        ['item_id' => 1, 'item_name' => 'anodised sheet', 'closing_qty' => 40.0, 'unit_cost' => 12.5, 'stock_value' => 500.0],
        ['item_id' => 2, 'item_name' => 'Brass fitting', 'closing_qty' => 12.0, 'unit_cost' => 7.25, 'stock_value' => 87.0],
    ];

    /** @param list<array<string, mixed>> $rows */
    private function names(array $rows): array
    {
        return array_map(static fn ($r) => $r['item_name'], $rows);
    }

    public function testValuationSortsByTheItemNameItDefaultsTo(): void
    {
        $sorted = ValuationController::sortSnapshotRows(self::SNAPSHOT, 'item_name', 'ASC');

        $this->assertSame(['anodised sheet', 'Brass fitting', 'Copper rod'], $this->names($sorted), 'case must not split the alphabet');
        $this->assertSame(['Copper rod', 'Brass fitting', 'anodised sheet'], $this->names(ValuationController::sortSnapshotRows(self::SNAPSHOT, 'item_name', 'DESC')));
    }

    public function testValuationSortsTheNumericColumnsNumerically(): void
    {
        $this->assertSame([87.0, 450.0, 500.0], array_map(
            static fn ($r) => $r['stock_value'],
            ValuationController::sortSnapshotRows(self::SNAPSHOT, 'stock_value', 'ASC'),
        ));
        $this->assertSame([40.0, 12.0, 5.0], array_map(
            static fn ($r) => $r['closing_qty'],
            ValuationController::sortSnapshotRows(self::SNAPSHOT, 'closing_qty', 'DESC'),
        ));
    }

    public function testAnUnknownValuationSortLeavesTheReplayOrderAlone(): void
    {
        $this->assertSame($this->names(self::SNAPSHOT), $this->names(ValuationController::sortSnapshotRows(self::SNAPSHOT, 'valuation_method', 'ASC')));
    }

    private const PENDING = [
        ['pending_id' => 11, 'document_date' => '2026-05-02', 'document_no' => 'DC-2', 'item_name' => 'Brass fitting', 'qty_open' => 4.0, 'status' => 'open'],
        ['pending_id' => 12, 'document_date' => '2026-04-11', 'document_no' => 'DC-1', 'item_name' => 'Copper rod', 'qty_open' => 25.0, 'status' => 'partial'],
        ['pending_id' => 13, 'document_date' => '2026-06-30', 'document_no' => 'DC-3', 'item_name' => 'Anodised sheet', 'qty_open' => 4.0, 'status' => 'open'],
    ];

    public function testPendingSortsByOpenQuantityLargestFirst(): void
    {
        $sorted = PendingQuantityService::sortOpenRows(self::PENDING, 'qty_open', 'DESC');

        $this->assertSame([25.0, 4.0, 4.0], array_map(static fn ($r) => $r['qty_open'], $sorted));
        // The tie keeps a single stable order, so page 2 does not repeat a row from page 1.
        $this->assertSame([12, 11, 13], array_map(static fn ($r) => $r['pending_id'], $sorted));
    }

    public function testPendingSortsByDocumentDateWhichIsItsDefault(): void
    {
        $this->assertSame(
            ['2026-06-30', '2026-05-02', '2026-04-11'],
            array_map(static fn ($r) => $r['document_date'], PendingQuantityService::sortOpenRows(self::PENDING, 'document_date', 'DESC')),
        );
        $this->assertSame(
            ['2026-04-11', '2026-05-02', '2026-06-30'],
            array_map(static fn ($r) => $r['document_date'], PendingQuantityService::sortOpenRows(self::PENDING, 'document_date', 'ASC')),
        );
    }

    public function testPendingSortsTextCaseInsensitively(): void
    {
        $this->assertSame(
            ['Anodised sheet', 'Brass fitting', 'Copper rod'],
            array_map(static fn ($r) => $r['item_name'], PendingQuantityService::sortOpenRows(self::PENDING, 'item_name', 'ASC')),
        );
    }

    public function testAnUnknownPendingSortKeepsTheServiceOrder(): void
    {
        $this->assertSame(
            [11, 12, 13],
            array_map(static fn ($r) => $r['pending_id'], PendingQuantityService::sortOpenRows(self::PENDING, 'nonsense', 'ASC')),
        );
    }
}
