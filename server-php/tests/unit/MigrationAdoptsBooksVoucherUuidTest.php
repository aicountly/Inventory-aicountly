<?php

namespace Tests\Unit;

use App\Services\Migration\MigrationLog;
use App\Services\Migration\Migrator;
use CodeIgniter\Database\BaseConnection;
use CodeIgniter\Database\Config as Db;
use PHPUnit\Framework\TestCase;

/**
 * source_document_uuid is Books' id for the document, not one Inventory invents.
 *
 * The migration minted a deterministic v5 from the vch_txn_id for every voucher it copied and
 * wrote that as source_document_uuid, ignoring the vch_uuid the header already carried. Books
 * never overwrites a uuid it has (books:backfill-vch-uuid fills nulls only), so every voucher
 * posted in Books before the migration ended up named one way here and another way there — and a
 * reference the two sides do not agree on is not a shared reference.
 *
 * @group unit
 */
final class MigrationAdoptsBooksVoucherUuidTest extends TestCase
{
    private const CMP = 91;

    /** Migrator::deterministicUuid('books_voucher_headers:512'), the id the Books backfill writes. */
    private const V5_FOR_512 = '15614c9a-ffc6-5520-92a5-3a02023ce3a3';

    private const BOOKS_V4 = '7b3f1d28-4e0a-4d6b-9f31-2c8a5e77b001';

    private ?BaseConnection $books = null;
    private ?BaseConnection $inv = null;

    protected function setUp(): void
    {
        parent::setUp();
        if (!extension_loaded('sqlite3')) {
            $this->markTestSkipped('sqlite3 required');
        }
        $this->books = $this->sqlite();
        $this->inv = $this->sqlite();
        $this->buildBooksSchema();
        $this->buildInventorySchema();
    }

    protected function tearDown(): void
    {
        $this->books?->close();
        $this->inv?->close();
        $this->books = null;
        $this->inv = null;
        parent::tearDown();
    }

    public function testAVoucherBooksHasAlreadyNamedIsCopiedUnderThatName(): void
    {
        $this->givenBooksVoucher(512, self::BOOKS_V4);

        $this->migrateDocuments();

        self::assertSame(self::BOOKS_V4, $this->sourceUuidOf(512), 'Inventory must carry the uuid Books holds for the voucher');
    }

    public function testAVoucherBooksHasNotNamedStillGetsTheDeterministicId(): void
    {
        $this->givenBooksVoucher(512, null);

        $this->migrateDocuments();

        self::assertSame(self::V5_FOR_512, $this->sourceUuidOf(512), 'a header with no vch_uuid keeps the id the Books backfill will give it');
    }

    public function testARerunBringsAnAlreadyCopiedDocumentBackOntoBooksUuid(): void
    {
        $this->givenBooksVoucher(512, self::BOOKS_V4);
        $this->givenMigratedDocument(512, self::V5_FOR_512, '2026-09-07 10:00:00');

        $this->migrateDocuments();

        self::assertSame(self::BOOKS_V4, $this->sourceUuidOf(512), 'the pair must end up equal, not merely stop diverging for new companies');
        self::assertSame(1, $this->documentCount(), 'the repair must not copy the document a second time');
    }

    public function testARerunLeavesAnAlreadyAgreeingDocumentAlone(): void
    {
        $this->givenBooksVoucher(512, self::BOOKS_V4);
        $this->givenMigratedDocument(512, self::BOOKS_V4, '2026-09-07 10:00:00');

        $this->migrateDocuments();

        $row = $this->documentRow(512);
        self::assertSame(self::BOOKS_V4, $row['source_document_uuid']);
        self::assertSame('2026-09-07 10:00:00', $row['updated_at'], 'a document that already agrees must not be rewritten');
    }

    private function migrateDocuments(): void
    {
        $migrator = new Migrator($this->books, $this->inv, $this->createMock(MigrationLog::class), 'test-run');
        $method = new \ReflectionMethod(Migrator::class, 'migrateDocuments');
        $method->setAccessible(true);
        // The last statement of migrateDocuments() restates base_qty with an UPDATE ... FROM,
        // which only PostgreSQL parses; with DBDebug off — as it is in every deployed
        // environment — it returns false and the copy stands, which is what is under test here.
        $method->invoke($migrator, self::CMP);
    }

    private function givenBooksVoucher(int $vchTxnId, ?string $vchUuid): void
    {
        $this->books->table('books_voucher_headers')->insert([
            'vch_txn_id' => $vchTxnId, 'vch_uuid' => $vchUuid, 'cmp_id' => self::CMP, 'fy_id' => 12, 'bo_id' => 0,
            'vch_type_id' => 20, 'vch_number' => 'SJ-3', 'vch_date' => '2026-09-07', 'status' => 'posted',
            'created_by' => 'seed', 'created_at' => '2026-09-07 09:00:00', 'updated_at' => '2026-09-07 09:00:00', 'version' => 1,
        ]);
        $this->books->table('books_voucher_inventory_lines')->insert([
            'inv_line_id' => 8100 + $vchTxnId, 'vch_txn_id' => $vchTxnId, 'cmp_id' => self::CMP, 'fy_id' => 12,
            'item_id' => 77, 'mc_id' => 3, 'unit_id' => 1, 'dr_cr' => 2, 'qty' => 5, 'rate' => 100, 'amount' => 500,
            'cost_rate' => 92.5, 'cost_amount' => 462.5, 'valuation_method_applied' => 'FIFO',
        ]);
    }

    private function givenMigratedDocument(int $documentId, string $sourceUuid, string $updatedAt): void
    {
        $this->inv->table('inv_documents')->insert([
            'document_id' => $documentId, 'document_uuid' => 'doc-' . $documentId, 'cmp_id' => self::CMP, 'bo_id' => 0, 'fy_id' => 12,
            'document_type' => 'STOCK_JOURNAL', 'document_no' => 'SJ-3', 'document_date' => '2026-09-07', 'status' => 'POSTED',
            'source_app' => 'books', 'source_document_type' => 'books.stock_journal', 'source_document_id' => $documentId,
            'source_document_uuid' => $sourceUuid, 'source_document_no' => 'SJ-3', 'source_document_date' => '2026-09-07',
            'updated_at' => $updatedAt, 'legacy_source_table' => 'books_voucher_headers', 'legacy_source_id' => $documentId,
            'legacy_vch_type_id' => 20,
        ]);
        $this->inv->table('inv_legacy_id_map')->insert([
            'cmp_id' => self::CMP, 'legacy_table' => 'books_voucher_headers', 'legacy_id' => $documentId,
            'target_table' => 'inv_documents', 'target_id' => $documentId, 'target_uuid' => 'doc-' . $documentId,
            'migration_run_id' => 'earlier-run', 'created_at' => '2026-09-07 10:00:00',
        ]);
    }

    private function sourceUuidOf(int $documentId): string
    {
        return (string) ($this->documentRow($documentId)['source_document_uuid'] ?? '');
    }

    /** @return array<string, mixed> */
    private function documentRow(int $documentId): array
    {
        return $this->inv->table('inv_documents')->where('document_id', $documentId)->get()->getRowArray() ?? [];
    }

    private function documentCount(): int
    {
        return $this->inv->table('inv_documents')->countAllResults();
    }

    private function sqlite(): BaseConnection
    {
        return Db::connect([
            'DSN' => '', 'hostname' => '', 'username' => '', 'password' => '', 'database' => ':memory:',
            'DBDriver' => 'SQLite3', 'DBPrefix' => '', 'pConnect' => false, 'DBDebug' => false,
            'charset' => 'utf8', 'DBCollat' => '', 'swapPre' => '', 'encrypt' => false, 'compress' => false,
            'strictOn' => false, 'failover' => [], 'port' => 3306, 'foreignKeys' => false, 'busyTimeout' => 1000,
        ], false);
    }

    private function buildBooksSchema(): void
    {
        $this->books->query('CREATE TABLE books_voucher_headers (vch_txn_id INTEGER, vch_uuid TEXT, cmp_id INTEGER, fy_id INTEGER, bo_id INTEGER, vch_type_id INTEGER, vch_number TEXT, vch_date TEXT, status TEXT, deleted_at TEXT, narration TEXT, party_acc_id INTEGER, dest_party_acc_id INTEGER, dest_mc_id INTEGER, dest_bo_id INTEGER, stock_effect TEXT, returnable INTEGER, expected_return_date TEXT, movement_reason TEXT, exchange_rate REAL, production_metadata_json TEXT, transport_json TEXT, created_by TEXT, created_at TEXT, updated_at TEXT, version INTEGER)');
        $this->books->query('CREATE TABLE books_voucher_inventory_lines (inv_line_id INTEGER, vch_txn_id INTEGER, cmp_id INTEGER, fy_id INTEGER, item_id INTEGER, mc_id INTEGER, unit_id INTEGER, dr_cr INTEGER, qty REAL, rate REAL, amount REAL, fc_rate REAL, fc_amount REAL, exchange_rate REAL, cost_rate REAL, cost_amount REAL, valuation_method_applied TEXT, book_qty REAL, physical_qty REAL, tax_cat_id INTEGER, hsn_sac TEXT, txn_id INTEGER)');
    }

    private function buildInventorySchema(): void
    {
        $this->inv->query('CREATE TABLE inv_documents (document_id INTEGER, document_uuid TEXT, cmp_id INTEGER, bo_id INTEGER, fy_id INTEGER, document_type TEXT, document_no TEXT, series_id INTEGER, document_date TEXT, status TEXT, source_app TEXT, source_document_type TEXT, source_document_id INTEGER, source_document_uuid TEXT, source_document_no TEXT, source_document_date TEXT, party_ref INTEGER, dest_party_ref INTEGER, from_warehouse_id INTEGER, to_warehouse_id INTEGER, dest_bo_id INTEGER, stock_effect TEXT, returnable INTEGER, expected_return_date TEXT, movement_reason TEXT, narration TEXT, currency_code TEXT, exchange_rate REAL, metadata_json TEXT, posted_by TEXT, posted_at TEXT, cancelled_at TEXT, version INTEGER, created_by TEXT, created_at TEXT, updated_at TEXT, legacy_source_table TEXT, legacy_source_id INTEGER, legacy_vch_type_id INTEGER)');
        $this->inv->query('CREATE TABLE inv_document_lines (line_id INTEGER, line_uuid TEXT, document_id INTEGER, cmp_id INTEGER, fy_id INTEGER, bo_id INTEGER, item_id INTEGER, warehouse_id INTEGER, unit_id INTEGER, direction TEXT, qty REAL, conversion_factor REAL, base_qty REAL, source_transaction_rate REAL, source_transaction_amount REAL, source_fc_rate REAL, source_fc_amount REAL, source_exchange_rate REAL, valuation_rate REAL, valuation_amount REAL, valuation_method_applied TEXT, book_qty REAL, physical_qty REAL, books_tax_cat_id INTEGER, hsn_sac TEXT, source_line_ref INTEGER, sort_order INTEGER, metadata_json TEXT, legacy_source_table TEXT, legacy_source_id INTEGER)');
        $this->inv->query('CREATE TABLE inv_legacy_id_map (cmp_id INTEGER, legacy_table TEXT, legacy_id INTEGER, target_table TEXT, target_id INTEGER, target_uuid TEXT, migration_run_id TEXT, created_at TEXT)');
        $this->inv->query('CREATE TABLE inv_item_uoms (cmp_id INTEGER, item_id INTEGER, unit_id INTEGER, conversion_factor REAL, is_default INTEGER)');
    }
}
