<?php

namespace Tests\Unit;

use App\Services\Migration\MigrationLog;
use App\Services\Migration\Validator;
use App\Services\ValuationReplayService;
use CodeIgniter\Database\BaseConnection;
use PHPUnit\Framework\TestCase;

/** A statement result, as CodeIgniter hands one back. */
final class StubBooksResult
{
    /** @param list<array<string, mixed>> $rows */
    public function __construct(private array $rows)
    {
    }

    /** @return list<array<string, mixed>> */
    public function getResultArray(): array
    {
        return $this->rows;
    }
}

/** Canned closing stock, so the gate can be driven without an Inventory database. */
final class StubValuationReplay extends ValuationReplayService
{
    /** @param list<array<string, mixed>> $rows */
    public function __construct(private array $rows = [])
    {
    }

    public function snapshot(int $cmpId, int $fyId, int $boId, ?string $asOf, string $reportMethod = 'AS_PER_MASTER', ?int $itemId = null, ?int $warehouseId = null): array
    {
        return [
            'rows' => $this->rows,
            'total_value' => array_sum(array_column($this->rows, 'stock_value')),
            'total_qty' => array_sum(array_column($this->rows, 'closing_qty')),
            'method' => $reportMethod,
        ];
    }
}

/**
 * The pre-cutover gate values the migrated stock with the replay and compares it item by item
 * with the valuation Books itself exported. The replay no longer costs a job-work receipt from
 * the challan value agreed with the job worker, so on those items the two engines now differ BY
 * DESIGN — and a gate that neither knows that nor prices it either blocks the cutover on a
 * difference nobody can name, or lets a real migration error hide behind one.
 *
 * @group unit
 */
final class MigrationParityJobWorkBasisTest extends TestCase
{
    private const CMP = 7;
    private const FY = 3;
    private const ITEM = 90;

    private string $dir = '';

    protected function tearDown(): void
    {
        foreach (glob($this->dir . '/*.json') ?: [] as $f) {
            unlink($f);
        }
        if ($this->dir !== '' && is_dir($this->dir)) {
            rmdir($this->dir);
        }
        parent::tearDown();
    }

    /** One job-work receipt line exactly as Books stored it. */
    private function jobWorkLine(float $qty, float $rate, ?float $costRate): array
    {
        return [
            'item_id' => self::ITEM, 'vch_txn_id' => 4411, 'vch_number' => 'JW/1', 'vch_date' => '2026-08-12',
            'qty' => $qty, 'rate' => $rate, 'cost_rate' => $costRate,
        ];
    }

    /**
     * @param list<array<string, mixed>> $jobWorkLines
     * @param list<array<string, mixed>> $inventoryRows
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    private function runGate(array $booksItems, array $inventoryRows, array $jobWorkLines): array
    {
        $this->dir = sys_get_temp_dir() . '/books-snapshot-' . bin2hex(random_bytes(6));
        mkdir($this->dir, 0775, true);
        file_put_contents($this->dir . '/cmp7.json', json_encode([
            'source' => 'books', 'cmp_id' => self::CMP, 'fy_id' => self::FY, 'bo_id' => 0, 'as_of' => '2027-03-31',
            'totals' => ['closing_qty' => array_sum(array_column($booksItems, 'closing_qty')), 'stock_value' => array_sum(array_column($booksItems, 'stock_value'))],
            'items' => $booksItems,
        ]));

        $books = $this->createMock(BaseConnection::class);
        $books->method('tableExists')->willReturn(false);
        $books->method('query')->willReturnCallback(static function (string $sql, ...$rest) use ($jobWorkLines) {
            return new StubBooksResult(str_contains($sql, 'h.vch_type_id = 6') ? $jobWorkLines : []);
        });

        $validator = new Validator($books, $this->createMock(BaseConnection::class), $this->createMock(MigrationLog::class), new StubValuationReplay($inventoryRows));
        $m = new \ReflectionMethod(Validator::class, 'booksSnapshot');
        $m->setAccessible(true);
        $out = ['ok' => true, 'failures' => [], 'warnings' => [], 'sections' => []];
        $args = [$this->dir, [], 0.0001, 0.01, &$out];

        return [$m->invokeArgs($validator, $args)['compared'][0], $out];
    }

    /** @param list<array<string, mixed>> $jobWorkLines */
    private function gateOnOneItem(float $booksValue, float $inventoryValue, array $jobWorkLines): array
    {
        return $this->runGate(
            [['item_id' => self::ITEM, 'closing_qty' => 10.0, 'unit_cost' => $booksValue / 10, 'stock_value' => $booksValue, 'valuation_method_applied' => 'FIFO']],
            [['item_id' => self::ITEM, 'closing_qty' => 10.0, 'unit_cost' => $inventoryValue / 10, 'stock_value' => $inventoryValue]],
            $jobWorkLines
        );
    }

    /**
     * Books valued the receipt at the 1250 agreed with the job worker, Inventory at the 640 the
     * goods cost. The gate must name that, not report it as a migration mismatch.
     */
    public function testTheDeliberateJobWorkValuationDifferenceIsNamedRatherThanFailed(): void
    {
        [$row, $out] = $this->gateOnOneItem(12500.0, 6400.0, [$this->jobWorkLine(10.0, 1250.0, 640.0)]);

        $this->assertSame([], $out['failures'], 'a difference the gate itself creates must not block the cutover');
        $this->assertSame([], $row['value_diffs']);
        $this->assertSame('job_work_receipt_valuation_basis', $row['explained_value_diffs'][0]['reason']);
        $this->assertEqualsWithDelta(6100.0, $row['explained_value_diffs'][0]['job_work_expected_delta'], 0.0001);
        $this->assertEqualsWithDelta(6100.0, $row['explained_value_diffs'][0]['job_work_max_delta'], 0.0001);
        $this->assertSame(4411, $row['explained_value_diffs'][0]['job_work_lines'][0]['vch_txn_id']);
        $this->assertArrayHasKey('job_work_receipt_valuation_basis', $row['value_explanation']);
        $this->assertNotSame([], $out['warnings'], 'explained is not silent: the cutover record still carries it');
    }

    /** Migrator copies cost_rate ?? null, so a receipt Books never costed enters Inventory at nothing. */
    public function testAReceiptBooksLeftWithoutACostIsPricedAndStillExplained(): void
    {
        [$row, $out] = $this->gateOnOneItem(12500.0, 0.0, [$this->jobWorkLine(10.0, 1250.0, null)]);

        $this->assertSame([], $out['failures']);
        $this->assertSame('job_work_receipt_valuation_basis', $row['explained_value_diffs'][0]['reason']);
        $this->assertEqualsWithDelta(12500.0, $row['explained_value_diffs'][0]['job_work_expected_delta'], 0.0001);
        $this->assertNull($row['explained_value_diffs'][0]['job_work_lines'][0]['line_cost_rate']);
    }

    /** The bound is the point: past what those receipts can account for, it is a real difference. */
    public function testADifferenceLargerThanTheJobWorkLinesCanAccountForStillFails(): void
    {
        [$row, $out] = $this->gateOnOneItem(12500.0, 3000.0, [$this->jobWorkLine(10.0, 1250.0, 640.0)]);

        $this->assertCount(1, $row['value_diffs']);
        $this->assertCount(1, $out['failures']);
        $this->assertEqualsWithDelta(6100.0, $row['value_diffs'][0]['job_work_max_delta'], 0.0001, 'the reviewer is told which part of it the job-work basis explains');
    }

    /** These lines can only push Books' figure up; a difference the other way is something else. */
    public function testADifferencePointingTheOtherWayStillFails(): void
    {
        [$row, $out] = $this->gateOnOneItem(6400.0, 12500.0, [$this->jobWorkLine(10.0, 1250.0, 640.0)]);

        $this->assertCount(1, $row['value_diffs']);
        $this->assertCount(1, $out['failures']);
    }

    /** Nothing else got looser: an item with no job-work receipt fails on any value difference. */
    public function testAnItemWithNoJobWorkReceiptStillFailsOnAnyValueDifference(): void
    {
        [$row, $out] = $this->gateOnOneItem(12500.0, 6400.0, []);

        $this->assertCount(1, $row['value_diffs']);
        $this->assertCount(1, $out['failures']);
    }

    /** The contract the gate states must be the contract the engines actually keep. */
    public function testTheParityContractNoLongerClaimsPlainReproduction(): void
    {
        $source = (string) file_get_contents((string) (new \ReflectionClass(Validator::class))->getFileName());

        $this->assertStringNotContainsString('snapshotValuation is reproduced by ValuationReplayService', $source);
    }
}
