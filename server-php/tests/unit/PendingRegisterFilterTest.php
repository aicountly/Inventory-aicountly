<?php

namespace Tests\Unit;

use App\Services\PendingRegisterPolicy;
use App\Services\PendingRegisterQuery;
use PHPUnit\Framework\TestCase;

/**
 * The pending register's request boundary.
 *
 * `normaliseFilters` is where a query string stops being text and becomes a WHERE
 * clause, so it is the one place a bad value has to be stopped. Its contract is to
 * DROP what it does not recognise rather than pass it through: a status the table
 * cannot hold or a kind that does not exist would otherwise become a filter that
 * silently matches nothing, and an empty register is a much harder bug to notice
 * than a rejected request.
 *
 * Nothing here touches a database — this is the parsing, and the SQL those filters
 * turn into is asserted against a real PostgreSQL in the integration suite.
 *
 * @group unit
 */
final class PendingRegisterFilterTest extends TestCase
{
    /** @param array<string, mixed> $input */
    private function f(array $input): array
    {
        return PendingRegisterQuery::normaliseFilters($input);
    }

    public function testAnEmptyRequestAsksForNothing(): void
    {
        $f = $this->f([]);

        foreach (['kind', 'direction', 'item_id', 'warehouse_id', 'party_ref', 'ageing_bucket', 'min_open_qty'] as $key) {
            $this->assertNull($f[$key], "{$key} should be absent, not defaulted");
        }
        $this->assertSame([], $f['status']);
        $this->assertSame([], $f['priority']);
        $this->assertFalse($f['overdue_only']);
    }

    public function testUnknownEnumeratedValuesAreDroppedRatherThanPassedThrough(): void
    {
        $f = $this->f([
            'kind'          => 'not_a_kind',
            'direction'     => 'sideways',
            'status'        => 'open,imaginary,cancelled',
            'priority'      => 'urgent,high',
            'ageing_bucket' => '99_100',
        ]);

        $this->assertNull($f['kind']);
        $this->assertNull($f['direction']);
        $this->assertSame(['open', 'cancelled'], $f['status'], 'the real ones survive, the invented one does not');
        $this->assertSame(['high'], $f['priority']);
        $this->assertNull($f['ageing_bucket']);
    }

    public function testEveryBucketThePolicyDeclaresIsAccepted(): void
    {
        foreach (array_keys(PendingRegisterPolicy::AGEING_BUCKETS) as $bucket) {
            $this->assertSame($bucket, $this->f(['ageing_bucket' => $bucket])['ageing_bucket']);
        }
    }

    public function testStatusAndPriorityAcceptArraysAsWellAsCsvAndNeverRepeat(): void
    {
        $this->assertSame(['open', 'partial'], $this->f(['status' => ['open', 'partial', 'open']])['status']);
        $this->assertSame(['open'], $this->f(['status' => 'OPEN, open ,open'])['status'], 'trimmed, lower-cased, de-duplicated');
    }

    public function testIdsMustBePositiveOrTheyAreNotIds(): void
    {
        $this->assertNull($this->f(['item_id' => 0])['item_id']);
        $this->assertNull($this->f(['item_id' => -4])['item_id']);
        $this->assertNull($this->f(['item_id' => 'abc'])['item_id']);
        $this->assertSame(55, $this->f(['item_id' => '55'])['item_id']);
    }

    public function testNumericRangesKeepZeroAndRejectNonsense(): void
    {
        // Zero is a real bound — "no more than nothing open" is a question, and
        // treating it as absent would quietly widen the filter.
        $this->assertSame(0.0, $this->f(['max_open_qty' => '0'])['max_open_qty']);
        $this->assertSame(12.5, $this->f(['min_open_qty' => '12.5'])['min_open_qty']);
        $this->assertNull($this->f(['min_open_qty' => ''])['min_open_qty']);
        $this->assertNull($this->f(['min_open_qty' => 'lots'])['min_open_qty']);
        $this->assertSame(-3.0, $this->f(['min_pending_value' => '-3'])['min_pending_value'], 'a negative bound is still a bound');
    }

    public function testOnlyRealDatesBecomeAPeriod(): void
    {
        $this->assertSame('2026-06-12', $this->f(['from' => '2026-06-12'])['from_date']);
        $this->assertNull($this->f(['from' => '12/06/2026'])['from_date']);
        $this->assertNull($this->f(['from' => '2026-6-1'])['from_date'], 'unpadded is not the wire format');
        $this->assertNull($this->f(['to' => "2026-06-12' OR 1=1"])['to_date']);
    }

    public function testTheOverdueToggleReadsTheFormsTruthyValuesAndNothingElse(): void
    {
        foreach (['1', 'true', 'yes', 'on', 'YES'] as $on) {
            $this->assertTrue($this->f(['overdue_only' => $on])['overdue_only'], "{$on} should read as on");
        }
        foreach (['0', 'false', 'no', '', 'maybe'] as $off) {
            $this->assertFalse($this->f(['overdue_only' => $off])['overdue_only'], "{$off} should read as off");
        }
    }

    public function testItemSearchAcceptsFreeTextBecauseItIsBoundNotInterpolated(): void
    {
        // The value is carried through verbatim and bound as a parameter; the SQL
        // it lands in is `ILIKE ?`. Sanitising it here would silently change what
        // a reader searched for.
        $this->assertSame("O'Brien & Co", $this->f(['item_search' => "O'Brien & Co"])['item_search']);
        $this->assertSame('', $this->f([])['item_search']);
    }

    public function testTheLegacyQueryKeyStillReachesTheItemSearch(): void
    {
        // `q` is what every other list endpoint calls free-text search, and the
        // shared list params send it.
        $this->assertSame('rod', $this->f(['q' => 'rod'])['item_search']);
    }

    public function testEverySortKeyTheWhitelistOffersIsSpelledOnce(): void
    {
        $keys = array_keys(PendingRegisterQuery::SORTABLE);
        $this->assertSame($keys, array_values(array_unique($keys)));
        // The register's default ordering has to be one of them, or the endpoint
        // silently falls back and the header arrow lies.
        $this->assertArrayHasKey('document_date', PendingRegisterQuery::SORTABLE);
    }
}
