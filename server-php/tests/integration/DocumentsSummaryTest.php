<?php

namespace Tests\Integration;

use App\Controllers\Api\V1\DocumentsController;
use Tests\Support\IntegrationTestCase;

/**
 * The documents register's aggregate over the WHOLE filtered set.
 *
 * `/v1/inventory-documents?summary=1` is what lets the register's KPI cards and
 * its pinned footer speak for every matching document instead of the fifty rows
 * the page happened to serve. It is two hand-written SQL reads, so the only
 * useful test is one that runs them against a real PostgreSQL and checks the
 * numbers — a mocked builder would prove the method returns an array and
 * nothing about whether the query is valid or correct.
 *
 * @group integration
 */
final class DocumentsSummaryTest extends IntegrationTestCase
{
    private function makeDocument(string $no, string $date = '2026-04-10', string $status = 'POSTED'): int
    {
        $this->db->table('inv_documents')->insert([
            'cmp_id' => $this->cmpId, 'bo_id' => $this->boId, 'fy_id' => $this->fyId,
            'document_type' => 'STOCK_TRANSFER', 'document_no' => $no,
            'document_date' => $date, 'status' => $status,
        ]);

        return (int) $this->db->insertID();
    }

    private function makeLine(int $documentId, int $itemId, ?int $warehouseId, ?int $destWarehouseId, ?float $valuation): void
    {
        $this->db->table('inv_document_lines')->insert([
            'document_id' => $documentId, 'cmp_id' => $this->cmpId, 'fy_id' => $this->fyId, 'bo_id' => $this->boId,
            'item_id' => $itemId, 'warehouse_id' => $warehouseId, 'dest_warehouse_id' => $destWarehouseId,
            'direction' => 'in', 'qty' => 1, 'conversion_factor' => 1, 'base_qty' => 1,
            'valuation_amount' => $valuation, 'sort_order' => 1,
        ]);
    }

    /** The filtered, unpaged builder index() hands to summarise(). */
    private function builder()
    {
        return $this->db->table('inv_documents d')
            ->where('d.cmp_id', $this->cmpId)
            ->where('d.fy_id', $this->fyId);
    }

    public function testTotalsEveryMatchingDocumentAndCountsTheWarehousesItsLinesTouch(): void
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Bolt', $pcs);
        $main = $this->makeWarehouse('Main');
        $north = $this->makeWarehouse('North');
        $south = $this->makeWarehouse('South');

        $a = $this->makeDocument('ST-1');
        $this->makeLine($a, $item, $main, $north, 100.5);
        $this->makeLine($a, $item, $main, null, 200.25);

        $b = $this->makeDocument('ST-2');
        // The destination is a warehouse no line names as a source — it still
        // counts, which is the whole reason the two columns are unioned.
        $this->makeLine($b, $item, $north, $south, 50.0);

        $summary = DocumentsController::summarise($this->builder(), 2);

        $this->assertNotNull($summary);
        $this->assertSame(2, $summary['documents']);
        $this->assertSame(3, $summary['line_count'], 'lines of every matching document, not of a page');
        $this->assertSame(350.75, $summary['valuation_total']);
        $this->assertSame(3, $summary['warehouses_impacted'], 'Main, North and South, each counted once');
    }

    public function testADocumentWithNoLinesImpactsNothingAndBreaksNothing(): void
    {
        $this->makeDocument('ST-EMPTY');

        $summary = DocumentsController::summarise($this->builder(), 1);

        $this->assertNotNull($summary);
        $this->assertSame(1, $summary['documents'], 'the document still matched the filters');
        $this->assertSame(0, $summary['line_count']);
        $this->assertSame(0.0, $summary['valuation_total']);
        $this->assertSame(0, $summary['warehouses_impacted']);
    }

    public function testLinesWithNoValuationCountWithoutAddingValue(): void
    {
        // A delivery challan's lines move stock and carry no valuation_amount at
        // all. They are lines, so they are counted; they are worth nothing here,
        // so the valuation must not become NULL for the whole register.
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Bolt', $pcs);
        $main = $this->makeWarehouse('Main');
        $doc = $this->makeDocument('DC-1');
        $this->makeLine($doc, $item, $main, null, null);
        $this->makeLine($doc, $item, $main, null, 75.0);

        $summary = DocumentsController::summarise($this->builder(), 1);

        $this->assertNotNull($summary);
        $this->assertSame(2, $summary['line_count']);
        $this->assertSame(75.0, $summary['valuation_total']);
        $this->assertSame(1, $summary['warehouses_impacted']);
    }

    public function testTheAggregateObeysTheSameFiltersTheRowsDid(): void
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Bolt', $pcs);
        $main = $this->makeWarehouse('Main');
        $north = $this->makeWarehouse('North');

        $kept = $this->makeDocument('ST-KEEP', '2026-04-10');
        $this->makeLine($kept, $item, $main, null, 10.0);
        $excluded = $this->makeDocument('ST-DROP', '2026-09-10');
        $this->makeLine($excluded, $item, $north, null, 999.0);

        // The same builder index() would have built for ?to=2026-06-30.
        $summary = DocumentsController::summarise($this->builder()->where('d.document_date <=', '2026-06-30'), 1);

        $this->assertNotNull($summary);
        $this->assertSame(1, $summary['line_count']);
        $this->assertSame(10.0, $summary['valuation_total'], 'the excluded document must not reach the total');
        $this->assertSame(1, $summary['warehouses_impacted'], 'nor its warehouse');
    }
}
