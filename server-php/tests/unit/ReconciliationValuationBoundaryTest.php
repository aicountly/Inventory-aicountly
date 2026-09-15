<?php

namespace Tests\Unit;

use App\Services\DocumentPostingService;
use App\Services\ReconciliationService;
use CodeIgniter\Database\BaseConnection;
use CodeIgniter\Database\Config as Db;
use Config\DocumentTypeRegistry;
use PHPUnit\Framework\TestCase;

/**
 * The reconciliation reports what stock is WORTH, so every figure it prints is a valuation.
 *
 * Both of its document queries read the line effect as
 * COALESCE(valuation_amount, source_transaction_amount, source_transaction_rate * qty, 0), which
 * falls straight through to the commercial figure Books owns whenever a line has not been valued
 * — and lines go unvalued by design: a delivery challan moves nothing, a defer_inward purchase
 * waits for its challan, a DRAFT sale has not been posted. So the "Stock effect" money column
 * printed the selling value of a consignment, and the buckets explained a stock-value gap with
 * invoice totals before deciding whether the residual was rounding or unexplained.
 *
 * Two rules settle it. A document that carries no valuation on its lines has no effect on the
 * stock value at all. And an unvalued line may only be estimated from its source rate when that
 * rate IS the cost of the goods — COST_BEARING_SOURCE_RATE — never from a selling price.
 *
 * @group unit
 */
final class ReconciliationValuationBoundaryTest extends TestCase
{
    private ?BaseConnection $db = null;

    /** @var array<string, mixed>|null */
    private ?array $savedConnections = null;

    protected function setUp(): void
    {
        parent::setUp();
        if (!extension_loaded('sqlite3')) {
            $this->markTestSkipped('sqlite3 required');
        }
        $this->db = Db::connect([
            'DSN' => '', 'hostname' => '', 'username' => '', 'password' => '', 'database' => ':memory:',
            'DBDriver' => 'SQLite3', 'DBPrefix' => '', 'pConnect' => false, 'DBDebug' => false,
            'charset' => 'utf8', 'DBCollat' => '', 'swapPre' => '', 'encrypt' => false, 'compress' => false,
            'strictOn' => false, 'failover' => [], 'port' => 3306, 'foreignKeys' => false, 'busyTimeout' => 1000,
        ], false);
        $this->db->query('CREATE TABLE inv_documents (document_id INTEGER, document_uuid TEXT, cmp_id INTEGER, fy_id INTEGER, bo_id INTEGER, document_type TEXT, document_no TEXT, document_date TEXT, status TEXT, stock_effect TEXT, source_app TEXT, source_document_type TEXT, source_document_id INTEGER, source_document_uuid TEXT, source_document_no TEXT, posted_at TEXT, cancelled_at TEXT, failure_reason TEXT)');
        $this->db->query('CREATE TABLE inv_document_lines (line_id INTEGER, document_id INTEGER, direction TEXT, qty REAL, source_transaction_rate REAL, source_transaction_amount REAL, valuation_amount REAL)');
    }

    protected function tearDown(): void
    {
        if ($this->savedConnections !== null) {
            self::connectionCache()->setValue(null, $this->savedConnections);
            $this->savedConnections = null;
        }
        $this->db?->close();
        $this->db = null;
        parent::tearDown();
    }

    private static function connectionCache(): \ReflectionProperty
    {
        $p = new \ReflectionProperty(\CodeIgniter\Database\Config::class, 'instances');
        $p->setAccessible(true);

        return $p;
    }

    /** Puts the in-memory fixture behind \Config\Database::connect() for the duration of one test. */
    private function useFixtureAsSharedConnection(): void
    {
        $cache = self::connectionCache();
        $this->savedConnections = $cache->getValue();
        $cache->setValue(null, array_merge($this->savedConnections, ['tests' => $this->db, 'default' => $this->db]));
    }

    private function givenDocument(int $id, string $type, ?string $stockEffect, string $status, array $line): void
    {
        $this->db->table('inv_documents')->insert([
            'document_id' => $id, 'document_uuid' => 'doc-' . $id, 'cmp_id' => 101, 'fy_id' => 5, 'bo_id' => 0,
            'document_type' => $type, 'document_no' => 'D-' . $id, 'document_date' => '2026-04-10', 'status' => $status, 'stock_effect' => $stockEffect,
            'source_app' => 'books', 'source_document_type' => 'books.voucher', 'source_document_id' => 500 + $id, 'source_document_no' => 'V-' . $id,
        ]);
        $this->db->table('inv_document_lines')->insert([
            'line_id' => $id * 10, 'document_id' => $id, 'direction' => $line['direction'], 'qty' => $line['qty'],
            'source_transaction_rate' => $line['rate'], 'source_transaction_amount' => $line['amount'], 'valuation_amount' => $line['valuation'] ?? null,
        ]);
    }

    /**
     * Exactly what both reconciliation queries do: select the line effect, then decide per
     * document whether it is a valuation at all.
     *
     * @return array<int, float>
     */
    private function valuationEffects(): array
    {
        $rows = $this->db->query('SELECT d.document_id, d.document_type, d.stock_effect, ' . ReconciliationService::lineValuationEffectSql() . ' AS valuation_effect FROM inv_documents d ORDER BY d.document_id')->getResultArray();
        $out = [];
        foreach ($rows as $row) {
            $out[(int) $row['document_id']] = ReconciliationService::valuationEffect($row);
        }

        return $out;
    }

    /** A consignment that moved no stock is worth nothing to the stock value, whatever it sold for. */
    public function testADocumentThatCarriesNoValuationReportsNothing(): void
    {
        $this->givenDocument(1, 'DELIVERY_CHALLAN', 'challan_only', 'POSTED', ['direction' => 'out', 'qty' => 3, 'rate' => 1000, 'amount' => 3000]);
        $this->givenDocument(2, 'PURCHASE_RECEIPT', 'defer_inward', 'POSTED', ['direction' => 'in', 'qty' => 5, 'rate' => 200, 'amount' => 1000]);
        $this->givenDocument(3, 'INWARD_CHALLAN', 'challan_only', 'POSTED', ['direction' => 'in', 'qty' => 2, 'rate' => 150, 'amount' => 300]);

        $effects = $this->valuationEffects();

        $this->assertSame(0.0, $effects[1], 'a delivery challan sold nothing out of the valuation pool');
        $this->assertSame(0.0, $effects[2], 'the goods of a deferred purchase arrive on the challan that settles it');
        $this->assertSame(0.0, $effects[3], 'a challan_only challan opens a pending quantity, not a cost layer');
    }

    /** An unvalued line may be estimated from its source rate only where that rate is a cost. */
    public function testAnUnvaluedLineIsEstimatedOnlyFromACostBearingRate(): void
    {
        $this->givenDocument(1, 'SALES_ISSUE', null, 'DRAFT', ['direction' => 'out', 'qty' => 2, 'rate' => 450, 'amount' => 900]);
        $this->givenDocument(2, 'SALES_RETURN', null, 'DRAFT', ['direction' => 'in', 'qty' => 1, 'rate' => 500, 'amount' => 500]);
        $this->givenDocument(3, 'PURCHASE_RECEIPT', null, 'DRAFT', ['direction' => 'in', 'qty' => 2, 'rate' => 50, 'amount' => 100]);

        $effects = $this->valuationEffects();

        $this->assertSame(0.0, $effects[1], 'a selling price is not what the stock cost');
        $this->assertSame(0.0, $effects[2], 'nor is the credit note raised for it');
        $this->assertSame(100.0, $effects[3], 'a purchase rate is the cost of the goods');
    }

    /** Once a line is valued it answers for itself, and the commercial amount beside it is ignored. */
    public function testAValuedLineReportsItsValuation(): void
    {
        $this->givenDocument(1, 'SALES_ISSUE', null, 'POSTED', ['direction' => 'out', 'qty' => 2, 'rate' => 200, 'amount' => 400, 'valuation' => 240]);

        $this->assertSame(-240.0, $this->valuationEffects()[1]);
    }

    /**
     * The report an operator actually reads: a right-aligned money column headed "Stock effect".
     *
     * A delivery challan dispatches goods at the price the customer will be invoiced; its lines
     * carry no valuation because it opens a pending quantity and touches no cost layer. Printing
     * its consignment value under "Stock effect" states the selling value of stock as the cost of
     * it, in the one report whose job is to tell those two apart.
     */
    public function testThePostingStatusMoneyColumnNeverPrintsACommercialAmount(): void
    {
        $this->givenDocument(1, 'DELIVERY_CHALLAN', 'challan_only', 'POSTED', ['direction' => 'out', 'qty' => 12, 'rate' => 702.0, 'amount' => 8424.0]);
        $this->givenDocument(2, 'PURCHASE_RECEIPT', 'defer_inward', 'POSTED', ['direction' => 'in', 'qty' => 5, 'rate' => 200, 'amount' => 1000]);
        $this->givenDocument(3, 'SALES_ISSUE', null, 'POSTED', ['direction' => 'out', 'qty' => 2, 'rate' => 200, 'amount' => 400, 'valuation' => 240]);
        $this->useFixtureAsSharedConnection();

        $books = new class () extends \App\Services\BooksApiClient {
            public function postingStatus(int $cmpId, int $fyId): array
            {
                return ['ok' => false, 'status' => 0, 'body' => null, 'error' => 'stub'];
            }
        };
        $entries = (new ReconciliationService($books))->postingStatus(101, 5, 0);

        $byDocument = [];
        foreach ($entries['entries'] as $e) {
            $byDocument[(int) $e['inventory']['document_id']] = (float) $e['inventory']['stock_effect'];
        }
        $this->assertSame(0.0, $byDocument[1], 'a dispatched consignment is not a stock value');
        $this->assertSame(0.0, $byDocument[2], 'a deferred purchase has received nothing yet');
        $this->assertSame(-240.0, $byDocument[3], 'the valued sale reports its COGS, not its invoice');
    }

    /**
     * valuesLines() answers what posting and reversal should DO and stays as it is; reading a
     * line's valuation needs to know whether posting ever wrote one, which is a different question.
     */
    public function testThePostingSwitchIsUnchangedByTheValuationAwarePredicate(): void
    {
        $purchase = DocumentTypeRegistry::get('PURCHASE_RECEIPT');
        $this->assertTrue(DocumentPostingService::valuesLines('PURCHASE_RECEIPT', $purchase, 'defer_inward'));
        $this->assertFalse(DocumentPostingService::valuesLinesNow('PURCHASE_RECEIPT', $purchase, 'defer_inward'));
        $this->assertTrue(DocumentPostingService::valuesLinesNow('PURCHASE_RECEIPT', $purchase, 'physical'));

        $sale = DocumentTypeRegistry::get('SALES_ISSUE');
        $this->assertFalse(DocumentPostingService::valuesLinesNow('SALES_ISSUE', $sale, 'from_physical_challan'));
        $this->assertTrue(DocumentPostingService::valuesLinesNow('SALES_ISSUE', $sale, 'from_packing'));

        // A revaluation records its delta on its lines without moving a unit of stock.
        $this->assertTrue(DocumentPostingService::valuesLinesNow('REVALUATION', DocumentTypeRegistry::get('REVALUATION'), ''));
    }
}
