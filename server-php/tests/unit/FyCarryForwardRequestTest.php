<?php

namespace Tests\Unit;

use App\Exceptions\InventoryException;
use App\Services\FyCarryForwardService;
use PHPUnit\Framework\TestCase;

/**
 * Pure request validation of the year-end carry-forward (no database).
 *
 * @group unit
 */
final class FyCarryForwardRequestTest extends TestCase
{
    /** @return array<string, mixed> */
    private function valid(): array
    {
        return [
            'source_fy_id' => '5', 'target_fy_id' => 6,
            'source_fy_start' => '2026-04-01', 'source_fy_end' => '2027-03-31T00:00:00',
            'target_fy_start' => '2027-04-01', 'target_fy_end' => '2028-03-31 00:00:00',
        ];
    }

    public function testNormalisesIdsDatesBranchAndOverwrite(): void
    {
        $r = FyCarryForwardService::normaliseRequest($this->valid() + ['overwrite' => 'true', 'bo_id' => '3'], 0);
        $this->assertSame([
            'source_fy_id' => 5, 'target_fy_id' => 6,
            'source_fy_start' => '2026-04-01', 'source_fy_end' => '2027-03-31',
            'target_fy_start' => '2027-04-01', 'target_fy_end' => '2028-03-31',
            'bo_id' => 3, 'overwrite' => true,
        ], $r);

        $r = FyCarryForwardService::normaliseRequest($this->valid(), 7);
        $this->assertSame(7, $r['bo_id'], 'branch falls back to the request context');
        $this->assertFalse($r['overwrite']);
        $this->assertFalse(FyCarryForwardService::normaliseRequest($this->valid() + ['overwrite' => '0'])['overwrite']);
        $this->assertTrue(FyCarryForwardService::normaliseRequest($this->valid() + ['overwrite' => 1])['overwrite']);
        $this->assertTrue(FyCarryForwardService::normaliseRequest($this->valid() + ['overwrite' => 'yes'])['overwrite']);
    }

    public function testRejectsMissingOrEqualYears(): void
    {
        $this->expectValidation(['source_fy_id' => 0, 'target_fy_id' => 6] + $this->valid(), 'source_fy_id');
        $this->expectValidation(['source_fy_id' => 6, 'target_fy_id' => 6] + $this->valid(), 'must differ');
    }

    public function testRejectsMissingOrInvalidDates(): void
    {
        $input = $this->valid();
        unset($input['target_fy_end']);
        $e = $this->expectValidation($input, 'target_fy_end');
        $this->assertSame(['target_fy_end'], $e->details()['fields']);

        $input = $this->valid();
        $input['source_fy_end'] = 'not a date';
        $input['target_fy_start'] = '';
        $e = $this->expectValidation($input, 'YYYY-MM-DD');
        $this->assertSame(['source_fy_end', 'target_fy_start'], $e->details()['fields']);
    }

    public function testRejectsInvertedOrOverlappingRanges(): void
    {
        $this->expectValidation(['source_fy_start' => '2027-04-01'] + $this->valid(), 'source_fy_start must not be after');
        $this->expectValidation(['target_fy_end' => '2027-01-01'] + $this->valid(), 'target_fy_start must not be after');
        $this->expectValidation(['target_fy_start' => '2027-03-31'] + $this->valid(), 'must start after the source year ends');
        $this->expectValidation(['bo_id' => -1] + $this->valid(), 'bo_id');
    }

    public function testDateAndFlagHelpers(): void
    {
        $this->assertNull(FyCarryForwardService::date(null));
        $this->assertNull(FyCarryForwardService::date('  '));
        $this->assertNull(FyCarryForwardService::date('garbage'));
        $this->assertSame('2027-03-31', FyCarryForwardService::date('31 March 2027'));
        $this->assertTrue(FyCarryForwardService::flag(true));
        $this->assertFalse(FyCarryForwardService::flag('false'));
        $this->assertFalse(FyCarryForwardService::flag(null));
        $this->assertTrue(FyCarryForwardService::flag('ON'));
    }

    private function expectValidation(array $input, string $messagePart): InventoryException
    {
        try {
            FyCarryForwardService::normaliseRequest($input);
        } catch (InventoryException $e) {
            $this->assertSame('validation_failed', $e->errorCode());
            $this->assertSame(422, $e->httpStatus());
            $this->assertStringContainsString($messagePart, $e->getMessage());

            return $e;
        }
        $this->fail('expected validation_failed for ' . json_encode($input));
    }
}
