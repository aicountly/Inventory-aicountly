<?php

namespace Tests\Unit;

use App\Services\OpeningStockResolver;
use App\Services\UnitConversionService;
use App\Services\ValuationEngine;
use PHPUnit\Framework\TestCase;

/**
 * The last-resort cost of an item is a cost, whatever document it is read off.
 *
 * resolveFallbackUnitCost() ends at the item's last inward line, and that line's source rate used
 * to be adopted as the cost whenever the line carried no valuation rate — with no look at what
 * kind of document the line sits on. For an item that only ever arrives from a job worker every
 * inward line is a JOB_WORK_IN challan, so the value agreed with the job worker (the figure
 * Table 5 of FORM GST ITC-04 declares) became the item's permanent cost basis: closing stock and
 * COGS priced at what was negotiated with the party rather than at what the stock cost.
 *
 * @group unit
 */
final class HistoricUnitCostBasisTest extends TestCase
{
    private const CMP = 7;

    /** The challan rate and amount a job-work receipt carries, and nothing typed in the cost column. */
    private const CHALLAN_RATE = 1250.0;

    /** @var list<string> */
    private array $selects = [];

    /**
     * A company-item with no cost layer, no weighted average and no opening — everything the
     * fallback tries before the last inward line.
     *
     * @param array<string, mixed>|null $lineRow
     */
    private function fallbackCost(?array $lineRow): float
    {
        $rows = ['inv_cost_layers' => null, 'inv_wac_state' => null, 'inv_document_lines l' => $lineRow];
        $selects = &$this->selects;
        $db = new class ($rows, $selects) {
            /** @param array<string, array<string, mixed>|null> $rows @param list<string> $selects */
            public function __construct(private array $rows, private array &$selects)
            {
            }

            public function table(string $name): object
            {
                return new class ($this->rows[$name] ?? null, $this->selects) {
                    /** @param array<string, mixed>|null $row @param list<string> $selects */
                    public function __construct(private ?array $row, private array &$selects)
                    {
                    }

                    public function select(string $fields): object
                    {
                        $this->selects[] = $fields;

                        return $this;
                    }

                    /** @param list<mixed> $args */
                    public function __call(string $method, array $args): object
                    {
                        return $this;
                    }

                    public function get(): object
                    {
                        return new class ($this->row) {
                            /** @param array<string, mixed>|null $row */
                            public function __construct(private ?array $row)
                            {
                            }

                            /** @return array<string, mixed>|null */
                            public function getRowArray(): ?array
                            {
                                return $this->row;
                            }
                        };
                    }
                };
            }
        };

        $units = new class extends UnitConversionService {
            public function factorFor(int $cmpId, int $itemId, ?int $unitId): float
            {
                return 1.0;
            }
        };
        $openings = new class extends OpeningStockResolver {
            /** @return array<int, list<array<string, mixed>>> */
            public function openingLayersByItem(int $cmpId, int $fyId, array $itemIds = []): array
            {
                return [];
            }
        };

        return (new ValuationEngine(null, $units, $openings))->resolveFallbackUnitCost($db, self::CMP, 90, null);
    }

    /** @return array<string, mixed> */
    private function inwardLine(string $documentType, ?float $valuationRate = null): array
    {
        return [
            'valuation_rate'            => $valuationRate,
            'source_transaction_rate'   => self::CHALLAN_RATE,
            'source_transaction_amount' => self::CHALLAN_RATE * 10,
            'base_qty'                  => 10.0,
            'qty'                       => 10.0,
            'unit_id'                   => 1,
            'document_type'             => $documentType,
        ];
    }

    public function testTheChallanValueOfAnEarlierJobWorkReceiptIsNotTheCostOfTheNextOne(): void
    {
        $cost = $this->fallbackCost($this->inwardLine('JOB_WORK_IN'));

        $this->assertEqualsWithDelta(0.0, $cost, 0.0001, 'the value agreed with the job worker is commercial — it is not what the stock cost');
        $this->assertNotEqualsWithDelta(self::CHALLAN_RATE, $cost, 0.0001);
    }

    /** A credit note's rate is the selling price; it leaks through the same door. */
    public function testTheSellingPriceOnASalesReturnIsNotACostEither(): void
    {
        $this->assertEqualsWithDelta(0.0, $this->fallbackCost($this->inwardLine('SALES_RETURN')), 0.0001);
    }

    public function testAPurchaseRateIsStillTheLastKnownCost(): void
    {
        $this->assertEqualsWithDelta(self::CHALLAN_RATE, $this->fallbackCost($this->inwardLine('PURCHASE_RECEIPT')), 0.0001);
    }

    /** Inventory's own column is a cost on every document type, job-work receipts included. */
    public function testACostTypedOnAJobWorkReceiptStillCounts(): void
    {
        $this->assertEqualsWithDelta(610.0, $this->fallbackCost($this->inwardLine('JOB_WORK_IN', 610.0)), 0.0001);
    }

    /** The gate can only be applied to a column the query actually reads. */
    public function testTheLastInwardLineIsReadWithTheDocumentTypeThatGatesIt(): void
    {
        $this->fallbackCost($this->inwardLine('JOB_WORK_IN'));

        $this->assertNotEmpty(array_filter($this->selects, static fn ($s) => str_contains($s, 'd.document_type')));
    }
}
