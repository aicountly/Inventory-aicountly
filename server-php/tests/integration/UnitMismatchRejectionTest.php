<?php

namespace Tests\Integration;

use App\Exceptions\InventoryException;
use App\Services\DocumentService;
use Tests\Support\IntegrationTestCase;

/**
 * A document line that names a unit the item was never registered under used to post silently
 * at a conversion factor of 1.0 (UnitConversionService::factorFor() cannot distinguish "this
 * unit legitimately converts 1:1" from "this unit was never configured for this item" and
 * defaulted to the former). Confirmed against real production data: item 6649 ("Silver
 * Articles", registered only in Grams) had two movements posted with a unit_id that doesn't
 * belong to it, landing at a ~1000x scale error (qty/rate consistent with Kilograms, posted as
 * if it were the registered Grams unit) -- silently, with nothing logged, corrupting its WAC
 * permanently. A company-wide scan found the same signature in 21 items across 4 companies.
 *
 * @group integration
 */
final class UnitMismatchRejectionTest extends IntegrationTestCase
{
    private DocumentService $docs;

    protected function setUp(): void
    {
        parent::setUp();
        $this->docs = new DocumentService();
    }

    private function addAlternateUnit(int $itemId, int $unitId, float $conversionFactor): void
    {
        $this->db->table('inv_item_uoms')->insert([
            'cmp_id' => $this->cmpId, 'item_id' => $itemId, 'unit_id' => $unitId,
            'is_default' => 0, 'conversion_factor' => $conversionFactor,
        ]);
    }

    public function testALineNamingAnUnregisteredUnitIsRejectedRatherThanSilentlyTreatedAsBaseUnit(): void
    {
        $grams = $this->makeUnit('Grams', 'g');
        $kilograms = $this->makeUnit('Kilograms', 'kg'); // exists company-wide, but never linked to this item
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Silver Articles', $grams, 'WAC');
        // Item 6649's real shape: exactly one registered unit (Grams), no Kilograms alternate ever added.

        $this->expectException(InventoryException::class);
        $this->expectExceptionMessageMatches('/unit "Kilograms" \(#' . $kilograms . '\) is not a registered unit for item "Silver Articles" \(#' . $item . '\)/');

        $this->docs->create($this->ctx(), [
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-06-30', 'source_document_type' => 'books.purchase', 'source_document_id' => 77314, 'source_document_no' => 'SA0767',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $kilograms, 'qty' => 17.693, 'rate' => 113346.1256, 'amount' => 2005433.00]],
        ], 'tester', 'books');
    }

    public function testALineNamingARealAlternateUnitStillPostsAndConvertsCorrectly(): void
    {
        $grams = $this->makeUnit('Grams', 'g');
        $kilograms = $this->makeUnit('Kilograms', 'kg');
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Silver Articles', $grams, 'WAC');
        $this->addAlternateUnit($item, $kilograms, 1000.0); // 1 Kilogram = 1000 Grams (the base)

        $doc = $this->docs->create($this->ctx(), [
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-06-30', 'source_document_type' => 'books.purchase', 'source_document_id' => 77314, 'source_document_no' => 'SA0767',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $kilograms, 'qty' => 17.693, 'rate' => 113.3461256, 'amount' => 2005.433]],
        ], 'tester', 'books');

        $line = $this->db->table('inv_document_lines')->where('document_id', (int) $doc['document_id'])->get()->getRowArray();
        self::assertNotNull($line);
        self::assertEqualsWithDelta(17693.0, (float) $line['base_qty'], 0.01, 'qty in Kilograms must convert to base Grams via the registered 1000x factor');
    }

    public function testOmittingUnitIdStillFallsBackToTheItemsDefaultUnitUnchanged(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Widget', $pcs);

        $doc = $this->docs->create($this->ctx(), [
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-06-30', 'source_document_type' => 'books.purchase', 'source_document_id' => 1, 'source_document_no' => 'P-1',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'qty' => 10, 'rate' => 5, 'amount' => 50]],
        ], 'tester', 'books');

        $line = $this->db->table('inv_document_lines')->where('document_id', (int) $doc['document_id'])->get()->getRowArray();
        self::assertNotNull($line);
        self::assertSame($pcs, (int) $line['unit_id']);
        self::assertEqualsWithDelta(10.0, (float) $line['base_qty'], 0.0001);
    }

    public function testAnItemCreatedAfterTheCompanyIsAlreadyWarmedIsStillCorrectlyRegistered(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $first = $this->makeItem('Widget One', $pcs);
        // Posting a line for $first forces UnitConversionService::warmCompany() to run and cache
        // "this company is warmed" -- $second does not exist yet at that point.
        $this->docs->create($this->ctx(), [
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-06-30', 'source_document_type' => 'books.purchase', 'source_document_id' => 3, 'source_document_no' => 'P-3',
            'lines' => [['item_id' => $first, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 1, 'rate' => 1, 'amount' => 1]],
        ], 'tester', 'books');

        $second = $this->makeItem('Widget Two', $pcs);
        $doc = $this->docs->create($this->ctx(), [
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-06-30', 'source_document_type' => 'books.purchase', 'source_document_id' => 4, 'source_document_no' => 'P-4',
            'lines' => [['item_id' => $second, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 5, 'amount' => 50]],
        ], 'tester', 'books');

        $line = $this->db->table('inv_document_lines')->where('document_id', (int) $doc['document_id'])->get()->getRowArray();
        self::assertNotNull($line, 'a line naming a later item\'s own base unit must post, not be rejected as unregistered');
        self::assertEqualsWithDelta(10.0, (float) $line['base_qty'], 0.0001);
    }

    public function testExplicitlyNamingTheItemsOwnBaseUnitIsAlwaysAccepted(): void
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Widget', $pcs);

        $doc = $this->docs->create($this->ctx(), [
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-06-30', 'source_document_type' => 'books.purchase', 'source_document_id' => 2, 'source_document_no' => 'P-2',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 5, 'amount' => 50]],
        ], 'tester', 'books');

        $line = $this->db->table('inv_document_lines')->where('document_id', (int) $doc['document_id'])->get()->getRowArray();
        self::assertNotNull($line);
        self::assertEqualsWithDelta(10.0, (float) $line['base_qty'], 0.0001);
    }
}
