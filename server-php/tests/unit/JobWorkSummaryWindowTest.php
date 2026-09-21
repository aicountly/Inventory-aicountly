<?php

namespace Tests\Unit;

use App\Services\JobWorkSummaryService;
use PHPUnit\Framework\TestCase;

/**
 * The two windows the job-work strip reports over.
 *
 * Every delta chip on that strip is "this month against last month", and the
 * chip is a lie in either of two ways if the windows are wrong: a month that
 * reaches outside the selected financial year counts documents the screen's own
 * year filter excludes, and a previous window that runs to the end of its month
 * compares eight days of trading with thirty-one.
 *
 * @group unit
 */
final class JobWorkSummaryWindowTest extends TestCase
{
    public function testMonthWindowIsTheMonthToDate(): void
    {
        $this->assertSame(
            ['from' => '2026-09-01', 'to' => '2026-09-18'],
            JobWorkSummaryService::monthWindow('2026-09-18', '2026-04-01', '2027-03-31'),
        );
    }

    public function testMonthWindowDoesNotReachBackBeforeTheYearOpened(): void
    {
        $this->assertSame(
            ['from' => '2026-04-15', 'to' => '2026-04-20'],
            JobWorkSummaryService::monthWindow('2026-04-20', '2026-04-15', '2027-03-31'),
        );
    }

    public function testMonthWindowDoesNotRunPastTheYearsLastDay(): void
    {
        $this->assertSame(
            ['from' => '2027-03-01', 'to' => '2027-03-20'],
            JobWorkSummaryService::monthWindow('2027-03-25', '2026-04-01', '2027-03-20'),
        );
    }

    public function testMonthWindowSurvivesNoCachedYearDates(): void
    {
        $this->assertSame(
            ['from' => '2026-09-01', 'to' => '2026-09-18'],
            JobWorkSummaryService::monthWindow('2026-09-18', null, null),
        );
    }

    public function testPreviousWindowStopsOnTheSameDayOfTheMonth(): void
    {
        // Eight days of September must be compared with eight days of August,
        // not with the whole of it.
        $this->assertSame(
            ['from' => '2026-08-01', 'to' => '2026-08-08'],
            JobWorkSummaryService::previousWindow('2026-09-08', '2026-04-01', '2027-03-31'),
        );
    }

    public function testPreviousWindowClampsToTheShorterMonth(): void
    {
        // The 31st of March has no counterpart in February; the comparative
        // runs to the last day that exists rather than rolling into March.
        $this->assertSame(
            ['from' => '2027-02-01', 'to' => '2027-02-28'],
            JobWorkSummaryService::previousWindow('2027-03-31', '2026-04-01', '2027-03-31'),
        );
    }

    public function testPreviousWindowCollapsesRatherThanReachingOutsideTheYear(): void
    {
        // April's comparative is March of the PREVIOUS financial year. Clipped
        // to this year it has no days at all, and an empty window is the honest
        // answer — the strip then simply shows no delta.
        $w = JobWorkSummaryService::previousWindow('2026-04-10', '2026-04-01', '2027-03-31');
        $this->assertSame('2026-04-01', $w['from']);
        $this->assertLessThanOrEqual($w['to'], $w['from']);
    }

    public function testPreviousWindowCrossesAYearBoundaryInTheCalendar(): void
    {
        $this->assertSame(
            ['from' => '2026-12-01', 'to' => '2026-12-09'],
            JobWorkSummaryService::previousWindow('2027-01-09', '2026-04-01', '2027-03-31'),
        );
    }
}
