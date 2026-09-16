<?php

namespace Tests\Unit;

use App\Services\RegisterSummaryService;
use PHPUnit\Framework\TestCase;

/**
 * The two dates the registers hub prints, and the window the movement count is
 * taken over.
 *
 * Both are captions on a strip that sits directly above the registers, so they
 * have to agree with what those registers would show. The count is filtered by
 * fy_id in SQL; if the window it is described by could reach outside the year,
 * the label above the figure would claim days the query silently dropped.
 *
 * @group unit
 */
final class RegisterSummaryWindowTest extends TestCase
{
    public function testAsOnIsTodayInsideTheOpenYear(): void
    {
        $this->assertSame(
            '2026-09-16',
            RegisterSummaryService::asOnDate('2026-09-16', '2026-04-01', '2027-03-31'),
        );
    }

    public function testAsOnFallsBackToTheCloseOfAYearThatHasEnded(): void
    {
        // Reading FY 2024-25 in September 2026: "as on 16 Sep 2026" over rows
        // that stop in March 2025 is a caption contradicting its own register.
        $this->assertSame(
            '2025-03-31',
            RegisterSummaryService::asOnDate('2026-09-16', '2024-04-01', '2025-03-31'),
        );
    }

    public function testAsOnIsTheOpeningDayOfAYearThatHasNotStarted(): void
    {
        $this->assertSame(
            '2027-04-01',
            RegisterSummaryService::asOnDate('2026-09-16', '2027-04-01', '2028-03-31'),
        );
    }

    public function testAsOnIsTodayWhenTheYearsDatesAreNotCachedLocally(): void
    {
        $this->assertSame('2026-09-16', RegisterSummaryService::asOnDate('2026-09-16', null, null));
    }

    public function testWindowIsTheMonthToDate(): void
    {
        $this->assertSame(
            ['from' => '2026-09-01', 'to' => '2026-09-16'],
            RegisterSummaryService::movementWindow('2026-09-16', '2026-04-01', '2027-03-31'),
        );
    }

    public function testWindowDoesNotReachBackIntoThePreviousYear(): void
    {
        // April's month starts on the 1st, which IS the year's opening day —
        // but a year opening mid-month must not have its window start before it.
        $this->assertSame(
            ['from' => '2026-04-15', 'to' => '2026-04-20'],
            RegisterSummaryService::movementWindow('2026-04-20', '2026-04-15', '2027-03-31'),
        );
    }

    public function testWindowDoesNotRunPastTheYearsLastDay(): void
    {
        $this->assertSame(
            ['from' => '2027-03-01', 'to' => '2027-03-20'],
            RegisterSummaryService::movementWindow('2027-03-25', '2026-04-01', '2027-03-20'),
        );
    }

    public function testWindowCollapsesRatherThanInvertingWhenTheYearIsOneDay(): void
    {
        $w = RegisterSummaryService::movementWindow('2026-09-16', '2026-09-16', '2026-09-16');
        $this->assertSame('2026-09-16', $w['from']);
        $this->assertSame('2026-09-16', $w['to']);
        $this->assertLessThanOrEqual($w['to'], $w['from']);
    }
}
