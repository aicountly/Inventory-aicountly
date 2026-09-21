<?php

namespace Tests\Unit;

use App\Controllers\Api\V1\UomController;
use App\Services\GstUqcCatalog;
use CodeIgniter\Test\CIUnitTestCase;

/**
 * The units list grew a "Used in 12 items" column and a Delete beside it.
 *
 * Those two have to agree. A count that includes a reference the delete guard
 * does not check is a screen telling the user a delete will be refused, and a
 * server going through with it and orphaning the rows it counted.
 */
final class UomUsageGuardTest extends CIUnitTestCase
{
    /** @return array<string, mixed> */
    private function property(string $name)
    {
        $ref = new \ReflectionClass(UomController::class);
        $prop = $ref->getProperty($name);
        $prop->setAccessible(true);

        return $prop->getDefaultValue();
    }

    public function testDeleteGuardCoversEveryItemColumnThatNamesAUnit(): void
    {
        $guards = $this->property('deleteGuards');
        $covered = [];
        foreach ($guards as $g) {
            $covered[] = $g['table'] . '.' . $g['column'];
        }

        // Exactly the columns usageRowsSql() unions, plus the document lines a
        // deleted unit would orphan.
        foreach ([
            'inv_items.unit_id',
            'inv_items.purchase_unit_id',
            'inv_items.sales_unit_id',
            'inv_item_uoms.unit_id',
            'inv_document_lines.unit_id',
        ] as $ref) {
            $this->assertContains($ref, $covered, $ref . ' is counted as usage but nothing blocks the delete');
        }
    }

    public function testUsageSqlUnionsTheSameColumnsTheGuardChecks(): void
    {
        $ctrl = new UomController();
        $m = (new \ReflectionClass($ctrl))->getMethod('usageRowsSql');
        $m->setAccessible(true);
        $sql = (string) $m->invoke($ctrl, 7);

        $this->assertStringContainsString('FROM inv_items', $sql);
        $this->assertStringContainsString('purchase_unit_id', $sql);
        $this->assertStringContainsString('sales_unit_id', $sql);
        $this->assertStringContainsString('FROM inv_item_uoms', $sql);
        // Tenant scoping is not optional in a fragment that is spliced raw.
        $this->assertSame(4, substr_count($sql, 'cmp_id = 7'));
        $this->assertStringContainsString('deleted_at IS NULL', $sql);
    }

    public function testUsageSqlTakesNoRequestInput(): void
    {
        $ctrl = new UomController();
        $m = (new \ReflectionClass($ctrl))->getMethod('usageRowsSql');
        $m->setAccessible(true);
        // The id list is built by the caller from intval()ed ids; a string that
        // arrived from a query parameter must never reach it.
        $sql = (string) $m->invoke($ctrl, 3, null, '(1,2,3)');
        $this->assertStringContainsString('IN (1,2,3)', $sql);
        $this->assertStringNotContainsString("'", $sql);
    }

    public function testTypeIsDerivedFromTheGstCatalogueAndNothingElse(): void
    {
        // Standard means "a return would accept this code as it stands".
        $this->assertTrue(GstUqcCatalog::isValid('KGS'));
        $this->assertTrue(GstUqcCatalog::isValid('kgs'), 'case must not decide the split');
        $this->assertTrue(GstUqcCatalog::isValid(' NOS '));
        $this->assertFalse(GstUqcCatalog::isValid(null));
        $this->assertFalse(GstUqcCatalog::isValid(''));
        $this->assertFalse(GstUqcCatalog::isValid('KILOS'));

        $this->assertSame('KGS', GstUqcCatalog::normalise('kgs'));
        $this->assertNull(GstUqcCatalog::normalise('nope'));
    }

    public function testCatalogueIsTheFullPublishedList(): void
    {
        $codes = GstUqcCatalog::codes();
        $this->assertCount(44, $codes, 'the GSTN schema publishes 44 unit quantity codes');
        $this->assertSame($codes, array_values(array_unique($codes)));
        foreach ($codes as $code) {
            $this->assertMatchesRegularExpression('/^[A-Z]{3}$/', $code);
        }
        $this->assertContains('OTH', $codes);
    }

    public function testSortExpressionOnlyAnswersForTheDerivedColumn(): void
    {
        $ctrl = new UomController();
        $m = (new \ReflectionClass($ctrl))->getMethod('sortExpression');
        $m->setAccessible(true);

        $this->assertNull($m->invoke($ctrl, 'unit_name', 1), 'a real column must order by itself');
        $expr = $m->invoke($ctrl, 'usage_count', 9);
        $this->assertIsString($expr);
        $this->assertStringContainsString('COUNT(DISTINCT t.item_id)', $expr);
        $this->assertStringContainsString('inv_uom.unit_id', $expr);
    }

    public function testUsageCountIsAdvertisedAsSortable(): void
    {
        $this->assertContains('usage_count', $this->property('extraSortColumns'));
        $this->assertContains('is_active', $this->property('extraSortColumns'));
    }

    public function testPrintNameIsSearchable(): void
    {
        $this->assertContains('print_name', $this->property('searchColumns'));
    }
}
