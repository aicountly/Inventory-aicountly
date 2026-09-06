<?php

namespace Tests\Integration;

use App\Exceptions\InventoryException;
use App\Services\BooksApiClient;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\InventorySettingsService;
use App\Services\ReconciliationService;
use Tests\Support\IntegrationTestCase;

/**
 * Canned Books responses so the reconciliation arithmetic can be asserted without a Books server.
 */
final class StubBooksApiClient extends BooksApiClient
{
    /** @var array{ok:bool, status:int, body:?array, error:?string} */
    public array $balanceResponse = ['ok' => false, 'status' => 0, 'body' => null, 'error' => 'stub: Books unreachable'];
    /** @var array{ok:bool, status:int, body:?array, error:?string} */
    public array $postingResponse = ['ok' => false, 'status' => 0, 'body' => null, 'error' => 'stub: Books unreachable'];
    /** @var list<array<string,mixed>> */
    public array $calls = [];

    public function stockLedgerBalance(int $cmpId, int $fyId, int $boId, string $asOf): array
    {
        $this->calls[] = ['stockLedgerBalance', $cmpId, $fyId, $boId, $asOf];

        return $this->balanceResponse;
    }

    public function postingStatus(int $cmpId, int $fyId): array
    {
        $this->calls[] = ['postingStatus', $cmpId, $fyId];

        return $this->postingResponse;
    }
}

/**
 * @group integration
 */
final class ReconciliationBreakdownTest extends IntegrationTestCase
{
    private DocumentService $docs;
    private DocumentPostingService $posting;
    private StubBooksApiClient $books;
    private ReconciliationService $reconciliation;

    protected function setUp(): void
    {
        parent::setUp();
        $this->docs = new DocumentService();
        $this->posting = new DocumentPostingService($this->docs);
        $this->books = new StubBooksApiClient();
        $this->reconciliation = new ReconciliationService($this->books);
    }

    private function postDoc(array $payload, string $source = 'books'): array
    {
        $doc = $this->docs->create($this->ctx(), $payload, 'tester', $source);

        return $this->posting->post($this->cmpId, (int) $doc['document_id'], 'tester', ['session' => ['kind' => 'service']]);
    }

    /**
     * Builds the scenario every test uses and returns the ids it created.
     *
     *   opening       10 @ 100 = 1,000 (Inventory opening value)
     *   PR  #501      10 @ 120 posted
     *   SI  #900      15 @ 300 posted  -> FIFO closing 5 @ 120 = 600
     *   PR  #601       2 @  50 DRAFT   -> pending_posting  (+100 stock effect, contribution -100)
     *   SI  #700       1 @  20 FAILED  -> failed_posting   (-20 stock effect, contribution +20)
     *   SI  #800       2 @ 200 posted then REVERSED -> cancelled_reversed (-240 effect, contribution +240)
     *   revision       delta 25 unacknowledged -> contribution -25
     */
    private function scenario(): array
    {
        $pcs = $this->makeUnit();
        $wh = $this->makeWarehouse();
        $item = $this->makeItem('Widget', $pcs, 'FIFO');
        $scarce = $this->makeItem('Scarce', $pcs, 'FIFO');
        $this->setOpening($item, $pcs, 10, 100);

        $purchase = $this->postDoc(['document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-10', 'source_document_type' => 'books.purchase', 'source_document_id' => 501, 'source_document_no' => 'P-1',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 10, 'rate' => 120, 'amount' => 1200]]]);
        $this->assertSame('POSTED', $purchase['status']);
        $sale = $this->postDoc(['document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-15', 'source_document_type' => 'books.sales', 'source_document_id' => 900, 'source_document_no' => 'S-1',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 15, 'rate' => 300, 'amount' => 4500]]]);
        $this->assertSame('POSTED', $sale['status']);

        // Pending: Books sent the purchase, Inventory has not posted it yet.
        $pending = $this->docs->create($this->ctx(), ['document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-18', 'source_document_type' => 'books.purchase', 'source_document_id' => 601, 'source_document_no' => 'P-2',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 2, 'rate' => 50, 'amount' => 100]]], 'tester', 'books');
        $this->assertSame('DRAFT', $pending['status']);

        // Failed: negative-stock block on an item with no stock.
        $this->db->table('inv_company_settings')->where('cmp_id', $this->cmpId)->update(['negative_stock_policy' => 'block']);
        InventorySettingsService::flush();
        $failedId = 0;
        try {
            $failedDoc = $this->docs->create($this->ctx(), ['document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-19', 'source_document_type' => 'books.sales', 'source_document_id' => 700, 'source_document_no' => 'S-2',
                'lines' => [['item_id' => $scarce, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 1, 'rate' => 20, 'amount' => 20]]], 'tester', 'books');
            $failedId = (int) $failedDoc['document_id'];
            $this->posting->post($this->cmpId, $failedId, 'tester', ['session' => ['kind' => 'service']]);
            $this->fail('expected negative stock block');
        } catch (InventoryException $e) {
            $this->assertSame('negative_stock_blocked', $e->errorCode());
        }
        $this->db->table('inv_company_settings')->where('cmp_id', $this->cmpId)->update(['negative_stock_policy' => 'allow']);
        InventorySettingsService::flush();
        $this->assertSame('FAILED', $this->db->table('inv_documents')->where('document_id', $failedId)->get()->getRowArray()['status']);

        // Reversed: sale posted and reversed in Inventory (Books still holds the invoice).
        $reversedSale = $this->postDoc(['document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-20', 'source_document_type' => 'books.sales', 'source_document_id' => 800, 'source_document_no' => 'S-3',
            'lines' => [['item_id' => $item, 'warehouse_id' => $wh, 'unit_id' => $pcs, 'qty' => 2, 'rate' => 200, 'amount' => 400]]]);
        $this->assertEqualsWithDelta(240.0, $reversedSale['lines'][0]['valuation_amount'], 0.0001);
        $reversed = $this->posting->reverse($this->cmpId, (int) $reversedSale['document_id'], 'tester', 'cancelled in Books');
        $this->assertSame('REVERSED', $reversed['status']);

        // One unacknowledged COGS revision on the posted sale.
        $this->db->table('inv_valuation_revisions')->insert([
            'cmp_id' => $this->cmpId, 'job_id' => 1, 'document_id' => (int) $sale['document_id'], 'line_id' => (int) $sale['lines'][0]['line_id'],
            'source_app' => 'books', 'source_document_type' => 'books.sales', 'source_document_id' => 900,
            'old_valuation_rate' => 100, 'new_valuation_rate' => 101.6667, 'old_valuation_amount' => 1600, 'new_valuation_amount' => 1625, 'delta_amount' => 25,
            'published_at' => date('Y-m-d H:i:s'), 'created_at' => date('Y-m-d H:i:s'),
        ]);

        return ['item' => $item, 'scarce' => $scarce, 'wh' => $wh, 'pcs' => $pcs, 'purchase' => $purchase, 'sale' => $sale, 'pending' => $pending, 'failed_id' => $failedId, 'reversed' => $reversed];
    }

    private function booksPostingBody(): array
    {
        return ['data' => [
            ['vch_txn_id' => 501, 'vch_type' => 11, 'status' => 'POSTED', 'amount' => 1200, 'vch_no' => 'P-1'],
            ['vch_txn_id' => 900, 'vch_type' => 18, 'status' => 'POSTED', 'amount' => -1600, 'vch_no' => 'S-1'],
            ['vch_txn_id' => 601, 'vch_type' => 11, 'status' => 'PENDING', 'amount' => 100, 'vch_no' => 'P-2'],
            ['vch_txn_id' => 700, 'vch_type' => 18, 'status' => 'POSTED', 'amount' => -20, 'vch_no' => 'S-2'],
            ['vch_txn_id' => 800, 'vch_type' => 18, 'status' => 'POSTED', 'amount' => -240, 'vch_no' => 'S-3'],
            // No inventory document for this Books voucher at all.
            ['vch_txn_id' => 777, 'vch_type' => 11, 'status' => 'POSTED', 'amount' => 55, 'vch_no' => 'P-9'],
        ]];
    }

    public function testDifferenceIsExplainedByBuckets(): void
    {
        $s = $this->scenario();
        // Inventory closing 5 @ 120 = 600. Explained contributions:
        //   opening +100 (1000 vs 900), pending -100, failed +20, reversed +240, revisions -25,
        //   revaluation -10 (Books only), manual journal -40, missing source -55  => 130
        // Books balance 469.70 -> difference 130.30 -> rounding 0.30.
        $this->books->balanceResponse = ['ok' => true, 'status' => 200, 'error' => null, 'body' => ['data' => [
            'balance'            => 469.70,
            'opening_balance'    => 900,
            'manual_journals'    => [['journal_id' => 5, 'amount' => 40, 'narration' => 'stock write-up']],
            'revaluations'       => [['vch_txn_id' => 42, 'amount' => 10]],
            'pending_postings'   => [['vch_txn_id' => 601, 'amount' => 100]],
            // failed_postings / cancelled_reversed deliberately missing: tolerated.
        ]]];
        $this->books->postingResponse = ['ok' => true, 'status' => 200, 'error' => null, 'body' => $this->booksPostingBody()];

        $run = $this->reconciliation->run($this->cmpId, $this->fyId, $this->boId, '2026-04-30', 'tester');

        $this->assertSame('COMPLETED', $run['status']);
        $this->assertEqualsWithDelta(600.0, $run['inventory_closing_value'], 0.0001);
        $this->assertEqualsWithDelta(5.0, $run['inventory_closing_qty'], 0.0001);
        $this->assertEqualsWithDelta(469.70, $run['books_stock_ledger_balance'], 0.0001);
        $this->assertEqualsWithDelta(130.30, $run['difference'], 0.0001);
        $this->assertSame(['stockLedgerBalance', $this->cmpId, $this->fyId, $this->boId, '2026-04-30'], $this->books->calls[0]);

        $b = $run['breakdown']['buckets'];
        $this->assertEqualsWithDelta(100.0, $b['opening_difference']['amount'], 0.0001);
        $this->assertEqualsWithDelta(1000.0, $b['opening_difference']['inventory_opening_value'], 0.0001);
        $this->assertEqualsWithDelta(-100.0, $b['pending_posting']['amount'], 0.0001);
        $this->assertSame(1, $b['pending_posting']['count']);
        $this->assertSame(601, $b['pending_posting']['documents'][0]['source_document_id']);
        $this->assertEqualsWithDelta(20.0, $b['failed_posting']['amount'], 0.0001);
        $this->assertSame($s['failed_id'], $b['failed_posting']['documents'][0]['document_id']);
        $this->assertEqualsWithDelta(240.0, $b['cancelled_reversed']['amount'], 0.0001);
        $this->assertSame(800, $b['cancelled_reversed']['documents'][0]['source_document_id']);
        $this->assertEqualsWithDelta(-25.0, $b['unacknowledged_valuation_revisions']['amount'], 0.0001);
        $this->assertSame(1, $b['unacknowledged_valuation_revisions']['count']);
        $this->assertEqualsWithDelta(-10.0, $b['revaluation']['amount'], 0.0001);
        $this->assertSame(0, $b['revaluation']['count']);
        $this->assertEqualsWithDelta(-40.0, $b['manual_journal']['amount'], 0.0001);
        $this->assertEqualsWithDelta(-55.0, $b['missing_source']['amount'], 0.0001);
        $this->assertSame(1, $b['missing_source']['count']);
        $this->assertSame(777, $b['missing_source']['entries'][0]['source']['source_document_id']);
        $this->assertEqualsWithDelta(130.0, $run['breakdown']['explained_total'], 0.0001);
        $this->assertEqualsWithDelta(0.30, $b['rounding']['amount'], 0.0001);
        $this->assertEqualsWithDelta(0.0, $b['unexplained']['amount'], 0.0001);

        $sum = 0.0;
        foreach ($b as $bucket) {
            $sum += (float) $bucket['amount'];
        }
        $this->assertEqualsWithDelta($run['difference'], $sum, 0.0001, 'buckets + rounding + unexplained == difference');

        // Persisted and readable back with the same numbers.
        $stored = $this->reconciliation->get($this->cmpId, (int) $run['run_id']);
        $this->assertNotNull($stored);
        $this->assertEqualsWithDelta(130.30, $stored['difference'], 0.0001);
        $this->assertSame('2026-04-30', $stored['as_of_date']);
        $this->assertNull($this->reconciliation->get($this->cmpId + 1, (int) $run['run_id']), 'tenant isolation');

        // Composite posting status.
        $status = $run['document_status'];
        $this->assertTrue($status['books_available']);
        $byId = [];
        foreach ($status['entries'] as $e) {
            $byId[(int) ($e['source']['source_document_id'] ?? 0)] = $e['sync_status'];
        }
        $this->assertSame('IN_SYNC', $byId[501]);
        $this->assertSame('IN_SYNC', $byId[900]);
        $this->assertSame('PENDING_INVENTORY', $byId[601]);
        $this->assertSame('FAILED_INVENTORY', $byId[700]);
        $this->assertSame('REVERSED_INVENTORY', $byId[800]);
        $this->assertSame('MISSING_IN_INVENTORY', $byId[777]);
        $this->assertSame(2, $status['summary']['IN_SYNC']);

        $this->assertSame(1, $this->db->table('inv_audit_log')->where('entity_type', 'reconciliation_run')->where('action', 'reconciliation.run')->countAllResults());
    }

    public function testLargeResidualIsUnexplainedNotRounding(): void
    {
        $this->scenario();
        $this->books->balanceResponse = ['ok' => true, 'status' => 200, 'error' => null, 'body' => ['data' => ['balance' => 400, 'opening_balance' => 1000]]];
        $this->books->postingResponse = ['ok' => true, 'status' => 200, 'error' => null, 'body' => ['data' => []]];

        $run = $this->reconciliation->run($this->cmpId, $this->fyId, $this->boId, '2026-04-30');
        $b = $run['breakdown']['buckets'];
        // explained: opening 0, pending -100, failed +20, reversed +240, revisions -25 => 135; difference 200 => residual 65
        $this->assertEqualsWithDelta(200.0, $run['difference'], 0.0001);
        $this->assertEqualsWithDelta(0.0, $b['opening_difference']['amount'], 0.0001);
        $this->assertEqualsWithDelta(135.0, $run['breakdown']['explained_total'], 0.0001);
        $this->assertEqualsWithDelta(0.0, $b['rounding']['amount'], 0.0001);
        $this->assertEqualsWithDelta(65.0, $b['unexplained']['amount'], 0.0001);
        // Books answered with no posting entries: posted documents are MISSING_IN_BOOKS.
        $summary = $run['document_status']['summary'];
        $this->assertSame(2, $summary['MISSING_IN_BOOKS']);
        $this->assertArrayNotHasKey('MISSING_IN_INVENTORY', $summary);
    }

    public function testBooksUnavailableStillPersistsInventorySide(): void
    {
        $this->scenario();
        // Default stub responses: Books unreachable.
        $run = $this->reconciliation->run($this->cmpId, $this->fyId, $this->boId, '2026-04-30');

        $this->assertSame('BOOKS_UNAVAILABLE', $run['status']);
        $this->assertNull($run['books_stock_ledger_balance']);
        $this->assertNull($run['difference']);
        $this->assertEqualsWithDelta(600.0, $run['inventory_closing_value'], 0.0001);
        $b = $run['breakdown']['buckets'];
        $this->assertFalse($run['breakdown']['books']['available']);
        $this->assertEqualsWithDelta(0.0, $b['opening_difference']['amount'], 0.0001);
        $this->assertNull($b['opening_difference']['books_opening_balance']);
        $this->assertEqualsWithDelta(-100.0, $b['pending_posting']['amount'], 0.0001);
        $this->assertEqualsWithDelta(240.0, $b['cancelled_reversed']['amount'], 0.0001);
        $this->assertEqualsWithDelta(-25.0, $b['unacknowledged_valuation_revisions']['amount'], 0.0001);
        $this->assertEqualsWithDelta(0.0, $b['manual_journal']['amount'], 0.0001);
        $this->assertEqualsWithDelta(0.0, $b['missing_source']['amount'], 0.0001);
        $this->assertNull($run['breakdown']['residual']);
        $this->assertSame(0, $b['rounding']['count']);
        $this->assertSame(0, $b['unexplained']['count']);
        $this->assertFalse($run['document_status']['books_available']);
        $this->assertSame(2, $run['document_status']['summary']['BOOKS_UNAVAILABLE']);

        $stored = $this->db->table('inv_reconciliation_runs')->where('run_id', (int) $run['run_id'])->get()->getRowArray();
        $this->assertSame('BOOKS_UNAVAILABLE', $stored['status']);
        $this->assertNull($stored['difference']);
    }

    public function testPostingStatusToleratesUuidMatchAndOddPayloadShapes(): void
    {
        $s = $this->scenario();
        $uuid = '7d3c8a5e-1b2f-4c6d-9e8f-0a1b2c3d4e5f';
        $this->db->table('inv_documents')->where('document_id', (int) $s['purchase']['document_id'])->update(['source_document_uuid' => $uuid]);
        // Entry list nested under data.entries, matched by vch_uuid only, statuses in Books' own vocabulary.
        $this->books->postingResponse = ['ok' => true, 'status' => 200, 'error' => null, 'body' => ['data' => ['entries' => [
            ['vch_uuid' => strtoupper($uuid), 'posting_status' => 'acked'],
            ['source_document_id' => 900, 'status' => 'cancelled'],
            ['vch_txn_id' => 800, 'status' => 'REVERSED'],
            ['status' => 'POSTED'], // no id at all: dropped
        ]]]];
        $status = $this->reconciliation->postingStatus($this->cmpId, $this->fyId, $this->boId);
        $byId = [];
        foreach ($status['entries'] as $e) {
            $byId[(int) ($e['source']['source_document_id'] ?? 0)] = $e['sync_status'];
        }
        $this->assertSame('IN_SYNC', $byId[501]);
        $this->assertSame('CANCELLED_IN_BOOKS', $byId[900]);
        $this->assertSame('CANCELLED_BOTH', $byId[800]);
        $this->assertSame('PENDING_INVENTORY', $byId[601]);
        $this->assertSame('FAILED_INVENTORY', $byId[700]);
        $this->assertArrayNotHasKey('MISSING_IN_INVENTORY', $status['summary']);
        $this->assertCount(5, $status['entries']);
    }
}
