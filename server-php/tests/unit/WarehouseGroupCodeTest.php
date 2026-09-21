<?php

namespace Tests\Unit;

use App\Controllers\Api\V1\WarehouseGroupsController;
use PHPUnit\Framework\TestCase;

/**
 * What a warehouse group's code is, once the API has had it.
 *
 * The rule has to be one rule because two things depend on it agreeing with itself: the partial
 * unique index uq_inv_warehouse_groups_cmp_code compares LOWER(grp_code), and the pre-flight check
 * in the controller compares the same way so the caller gets a 409 naming the field instead of a
 * Postgres constraint name in a 500. A normaliser that let " ret " and "RET" through as two
 * different values would make the check pass and the index refuse — the worst of both.
 *
 * Blank is null, not "". An empty string would occupy the index (one company could then have only
 * one un-coded group) and would print as an empty cell that reads like a code nobody typed.
 *
 * No database: the rule is pure and is asserted as such.
 *
 * @group unit
 */
final class WarehouseGroupCodeTest extends TestCase
{
    public function testTrimsAndUpperCases(): void
    {
        $this->assertSame('RET', WarehouseGroupsController::normaliseCode('  ret  '));
        $this->assertSame('MFG', WarehouseGroupsController::normaliseCode('Mfg'));
        $this->assertSame('GEN', WarehouseGroupsController::normaliseCode('GEN'));
    }

    public function testBlankBecomesNullSoItNeverOccupiesTheUniqueIndex(): void
    {
        $this->assertNull(WarehouseGroupsController::normaliseCode(''));
        $this->assertNull(WarehouseGroupsController::normaliseCode('   '));
        $this->assertNull(WarehouseGroupsController::normaliseCode(null));
    }

    public function testCaseVariantsCollapseToOneStoredValue(): void
    {
        // Exactly what the unique index treats as the same code, so the controller's own check
        // cannot pass a value the database will then refuse.
        $this->assertSame(
            WarehouseGroupsController::normaliseCode('ret'),
            WarehouseGroupsController::normaliseCode('ReT'),
        );
    }

    public function testInnerSpacingAndPunctuationAreLeftAlone(): void
    {
        // The code is the company's handle, not a slug: "N-01" and "SCR/REJ" are theirs to choose.
        // Only the edges and the case are the API's business.
        $this->assertSame('N-01', WarehouseGroupsController::normaliseCode(' n-01 '));
        $this->assertSame('SCR/REJ', WarehouseGroupsController::normaliseCode('scr/rej'));
    }
}
