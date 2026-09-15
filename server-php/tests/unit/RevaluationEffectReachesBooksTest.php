<?php

namespace Tests\Unit;

use App\Services\AccessService;
use App\Services\AuditService;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\InventorySettingsService;
use App\Services\ManageContextService;
use App\Services\OutboxService;
use App\Services\PackingService;
use App\Services\PendingQuantityService;
use App\Services\StockBalanceService;
use App\Services\StockStatusService;
use App\Services\UnitConversionService;
use App\Services\ValuationEngine;
use CodeIgniter\Database\BaseConnection;
use CodeIgniter\Database\Config as Db;
use Config\DocumentTypeRegistry;
use PHPUnit\Framework\TestCase;

/**
 * A revaluation changes what the stock on hand is worth, and Books is the only place that change
 * can be journalled — Inventory never posts to a ledger. The one channel is the accounting effects
 * of the posted document: post() writes inv_documents.accounting_effects_json and publishes the
 * outbox payload from the array applyPosting() returns, both inside the posting transaction.
 *
 * So the effect has to be IN that array. Writing STOCK_REVALUATION straight to the column while
 * applying the revaluation put it in the one place post() overwrites moments later, in the same
 * transaction: the effect was destroyed before it had been read once, and every revaluation left
 * the cost layers re-priced with Books never told the stock value had moved.
 *
 * @group unit
 */
final class RevaluationEffectReachesBooksTest extends TestCase
{
    private const CMP = 101;

    private const DOC = 500;

    private ?BaseConnection $db = null;

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
        $this->db->query('CREATE TABLE inv_documents (document_id INTEGER PRIMARY KEY, accounting_effects_json TEXT)');
        $this->db->query('CREATE TABLE inv_document_lines (line_id INTEGER PRIMARY KEY, document_id INTEGER, valuation_amount REAL)');
        $this->db->query('CREATE TABLE inv_cost_layers (layer_id INTEGER PRIMARY KEY, cmp_id INTEGER, item_id INTEGER, warehouse_id INTEGER, qty_remaining REAL, unit_cost REAL)');
        $this->db->query('CREATE TABLE inv_wac_state (cmp_id INTEGER, item_id INTEGER, warehouse_id INTEGER, qty_on_hand REAL, average_cost REAL, updated_at TEXT)');
        $this->db->table('inv_documents')->insert(['document_id' => self::DOC, 'accounting_effects_json' => null]);
    }

    protected function tearDown(): void
    {
        $this->db?->close();
        $this->db = null;
        parent::tearDown();
    }

    private function givenOpenLayer(int $itemId, float $qty, float $unitCost): void
    {
        $this->db->table('inv_cost_layers')->insert(['cmp_id' => self::CMP, 'item_id' => $itemId, 'warehouse_id' => null, 'qty_remaining' => $qty, 'unit_cost' => $unitCost]);
    }

    private function givenLine(int $lineId, int $itemId, float $newCost): array
    {
        $this->db->table('inv_document_lines')->insert(['line_id' => $lineId, 'document_id' => self::DOC, 'valuation_amount' => null]);

        return ['line_id' => $lineId, 'item_id' => $itemId, 'unit_id' => 1, 'warehouse_id' => null, 'batch_id' => null, 'qty' => 0.0, 'base_qty' => 0.0, 'valuation_rate' => $newCost];
    }

    /** @param list<array<string, mixed>> $lines */
    private function postRevaluation(array $lines): array
    {
        $valuation = $this->createMock(ValuationEngine::class);
        $valuation->method('scopeWarehouse')->willReturn(null);
        $posting = new DocumentPostingService(
            $this->createMock(DocumentService::class),
            $valuation,
            $this->createMock(StockBalanceService::class),
            $this->createMock(StockStatusService::class),
            $this->createMock(PendingQuantityService::class),
            $this->createMock(UnitConversionService::class),
            $this->createMock(InventorySettingsService::class),
            $this->createMock(ManageContextService::class),
            $this->createMock(OutboxService::class),
            $this->createMock(AuditService::class),
            $this->createMock(AccessService::class),
            $this->createMock(PackingService::class),
        );
        $doc = [
            'document_id' => self::DOC, 'fy_id' => 5, 'bo_id' => 0, 'document_type' => 'REVALUATION',
            'document_date' => '2026-06-01', 'stock_effect' => '', 'party_ref' => null, 'metadata' => [],
            'accounting_effects_json' => null, 'lines' => $lines,
        ];
        $warnings = [];
        $method = new \ReflectionMethod(DocumentPostingService::class, 'applyPosting');

        return $method->invokeArgs($posting, [$this->db, self::CMP, $doc, DocumentTypeRegistry::get('REVALUATION'), 'actor-uuid', [], &$warnings]);
    }

    private function storedEffects(): ?string
    {
        return $this->db->table('inv_documents')->where('document_id', self::DOC)->get()->getRowArray()['accounting_effects_json'];
    }

    private function lineAmount(int $lineId): ?float
    {
        $row = $this->db->table('inv_document_lines')->where('line_id', $lineId)->get()->getRowArray();

        return $row['valuation_amount'] !== null ? (float) $row['valuation_amount'] : null;
    }

    /** The finding: re-pricing 10 units from 70 to 120 raised the stock value by 500 and said nothing. */
    public function testTheRevaluationDeltaIsOneOfTheEffectsPostingHandsBack(): void
    {
        $this->givenOpenLayer(7, 10.0, 70.0);

        $result = $this->postRevaluation([$this->givenLine(1, 7, 120.0)]);

        $this->assertSame([['effect' => 'STOCK_REVALUATION', 'amount' => 500.0]], $result['effects']);
    }

    /**
     * post() is the only writer of accounting_effects_json, because it is the only one that also
     * publishes. An effect written to the column while the revaluation is applied is overwritten
     * by post() a few statements later in the same transaction.
     */
    public function testApplyingTheRevaluationWritesNoEffectBehindPostsBack(): void
    {
        $this->givenOpenLayer(7, 10.0, 70.0);

        $this->postRevaluation([$this->givenLine(1, 7, 120.0)]);

        $this->assertNull($this->storedEffects(), 'the column belongs to post(), which writes what applyPosting returned');
    }

    /** Both halves of the channel read the returned array, so that is where the effect has to be. */
    public function testPostPersistsAndPublishesTheArrayApplyPostingReturned(): void
    {
        $source = (string) file_get_contents((string) (new \ReflectionClass(DocumentPostingService::class))->getFileName());

        $this->assertStringContainsString("'accounting_effects_json' => json_encode(\$effects, JSON_UNESCAPED_UNICODE)", $source);
        $this->assertStringContainsString('$this->eventPayload($posted, $effects)', $source);
    }

    /**
     * Each line reports the delta it caused. Stamping every line with the running total of the
     * lines before it makes the document's own lines add up to more than it revalued — the last
     * line alone already carries the whole document.
     */
    public function testEachLineCarriesItsOwnDeltaAndTheEffectCarriesTheTotal(): void
    {
        $this->givenOpenLayer(7, 10.0, 70.0);
        $this->givenOpenLayer(8, 4.0, 25.0);

        $result = $this->postRevaluation([$this->givenLine(1, 7, 120.0), $this->givenLine(2, 8, 30.0)]);

        $this->assertSame(500.0, $this->lineAmount(1));
        $this->assertSame(20.0, $this->lineAmount(2));
        $this->assertSame([['effect' => 'STOCK_REVALUATION', 'amount' => 520.0]], $result['effects']);
    }

    /** The weighted-average state is revalued on the same terms and counts towards the same delta. */
    public function testTheWeightedAverageStateIsPartOfTheDelta(): void
    {
        $this->givenOpenLayer(7, 10.0, 70.0);
        $this->db->table('inv_wac_state')->insert(['cmp_id' => self::CMP, 'item_id' => 7, 'warehouse_id' => 0, 'qty_on_hand' => 6.0, 'average_cost' => 100.0]);

        $result = $this->postRevaluation([$this->givenLine(1, 7, 120.0)]);

        $this->assertSame([['effect' => 'STOCK_REVALUATION', 'amount' => 620.0]], $result['effects']);
        $this->assertSame(120.0, (float) $this->db->table('inv_wac_state')->where('item_id', 7)->get()->getRowArray()['average_cost']);
    }

    /** A revaluation that moves nothing is not an accounting event, the same rule every other effect follows. */
    public function testRepricingStockToWhatItAlreadyCostEmitsNothing(): void
    {
        $this->givenOpenLayer(7, 10.0, 70.0);

        $result = $this->postRevaluation([$this->givenLine(1, 7, 70.0)]);

        $this->assertSame([], $result['effects']);
    }
}
