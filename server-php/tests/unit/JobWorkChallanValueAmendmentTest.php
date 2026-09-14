<?php

namespace Tests\Unit;

use App\Controllers\Api\V1\DocumentsController;
use App\Exceptions\InventoryException;
use App\Services\AuditService;
use App\Services\DocumentService;
use App\Services\InventorySettingsService;
use App\Services\UnitConversionService;
use CodeIgniter\Test\CIUnitTestCase;

/**
 * A connection that fails the way the production one does, in the two ways a local fixture does
 * not: DBDebug is off on the default group, so a refused statement returns false instead of
 * throwing, and PostgreSQL refuses everything else in the transaction once one statement has
 * failed. CI4 latches its own transaction flag on that failure (transStrict is on, so nothing
 * clears it), and COMMIT on such a transaction quietly performs a ROLLBACK.
 */
final class StubAbortingChallanConnection
{
    public string $DBDriver = 'Postgre';

    /** @var list<string> */
    public array $log = [];

    public bool $committed = false;

    /** Tables whose UPDATE the server refuses. */
    public array $refuse = [];

    private bool $transStatus = true;

    private bool $aborted = false;

    public function transStart(bool $testMode = false): bool
    {
        $this->log[] = 'BEGIN';
        $this->aborted = false;

        return true;
    }

    public function table(string $table): StubAbortingChallanBuilder
    {
        return new StubAbortingChallanBuilder($this, $table);
    }

    public function runUpdate(string $table): bool
    {
        if ($this->aborted || in_array($table, $this->refuse, true)) {
            $this->aborted = true;
            $this->transStatus = false;
            $this->log[] = 'UPDATE ' . $table . ' REFUSED';

            return false;
        }
        $this->log[] = 'UPDATE ' . $table;

        return true;
    }

    public function transComplete(): bool
    {
        if ($this->transStatus === false) {
            $this->transRollback();

            return false;
        }
        $this->log[] = 'COMMIT';
        $this->committed = true;

        return true;
    }

    public function transStatus(): bool
    {
        return $this->transStatus;
    }

    public function transRollback(): bool
    {
        $this->log[] = 'ROLLBACK';

        return true;
    }

    public function resetTransStatus(): static
    {
        $this->transStatus = true;

        return $this;
    }
}

final class StubAbortingChallanBuilder
{
    public function __construct(private StubAbortingChallanConnection $db, private string $table) {}

    public function where($field, $value = null): self
    {
        return $this;
    }

    /** @param array<string, mixed> $set */
    public function update(array $set): bool
    {
        return $this->db->runUpdate($this->table);
    }
}

/** Keeps what was written to the append-only trail instead of writing it. */
final class RecordingAuditService extends AuditService
{
    /** @var list<array<string, mixed>> */
    public array $entries = [];

    public function log(int $cmpId, string $entityType, int $entityId, string $action, ?string $actorUuid, array $meta = [], ?array $before = null, ?array $after = null): void
    {
        $this->entries[] = ['action' => $action, 'before' => $before, 'after' => $after];
    }
}

/**
 * Recording the challan value of a job-work dispatch that is already posted.
 *
 * Books' Job Work Out never captured a value — books_voucher_job_work_lines holds item, unit,
 * qty and material centre only — so every one the migration moved out of Books lands here POSTED
 * and worth nothing, and Table 4 of FORM GST ITC-04 declares exactly that value. Books refuses
 * vch_type 6/7 at draft time and a posted document is outside EDITABLE_STATUSES, so until this
 * path existed the ITC-04 screen told the operator to enter a value that no screen would accept,
 * and the quarter could never be filed. revise() is not a substitute: it reverses and re-creates
 * under a new document_id, reopening the pending quantities a later JOB_WORK_IN settled.
 *
 * @group unit
 */
final class JobWorkChallanValueAmendmentTest extends CIUnitTestCase
{
    private function service(): DocumentService
    {
        return new class (new UnitConversionService(), new AuditService(), new InventorySettingsService()) extends DocumentService {
            /** @param array<string, mixed> $doc */
            public function writesFor(array $doc, array $payload): array
            {
                return $this->challanValueWrites($doc, $payload);
            }
        };
    }

    /** A Job Work Out exactly as inventory:migrate-books leaves it: posted, no value at all. */
    private function migratedDispatch(string $status = 'POSTED', string $type = 'JOB_WORK_OUT'): array
    {
        return [
            'document_id' => 8801, 'document_type' => $type, 'document_no' => 'JWO/25-26/017',
            'status' => $status, 'version' => 3, 'source_app' => 'books',
            'lines' => [
                ['line_id' => 2000008801, 'item_id' => 90, 'qty' => 120.0, 'unit_id' => 3, 'direction' => 'out',
                    'source_transaction_rate' => null, 'source_transaction_amount' => null,
                    'valuation_rate' => null, 'valuation_amount' => null],
                ['line_id' => 2000008802, 'item_id' => 91, 'qty' => 20.0, 'unit_id' => 3, 'direction' => 'out',
                    'source_transaction_rate' => null, 'source_transaction_amount' => null,
                    'valuation_rate' => null, 'valuation_amount' => null],
            ],
        ];
    }

    public function testAPostedDispatchCanStillBeGivenTheChallanValueItWasMigratedWithout(): void
    {
        $writes = $this->service()->writesFor($this->migratedDispatch(), ['lines' => [
            ['line_id' => 2000008801, 'rate' => 800],
        ]]);

        $this->assertSame([2000008801], array_keys($writes));
        $this->assertSame(800.0, $writes[2000008801]['source_transaction_rate']);
        $this->assertSame(96000.0, $writes[2000008801]['source_transaction_amount']);
    }

    /**
     * The single invariant this path exists under: a challan value is COMMERCIAL. A valuation
     * figure is what the stock cost, on a basis no challan declares, and it must never reach
     * Table 4 through here.
     */
    public function testOnlyTheCommercialPairIsEverWritten(): void
    {
        $writes = $this->service()->writesFor($this->migratedDispatch(), ['lines' => [
            ['line_id' => 2000008801, 'rate' => 800, 'valuation_rate' => 610, 'valuation_amount' => 73200, 'qty' => 999],
            ['line_id' => 2000008802, 'amount' => 9000],
        ]]);

        foreach ($writes as $set) {
            $this->assertSame(['source_transaction_rate', 'source_transaction_amount'], array_keys($set));
        }
    }

    public function testAnAmountOnItsOwnBackfillsTheRateFromTheLineQuantity(): void
    {
        $writes = $this->service()->writesFor($this->migratedDispatch(), ['lines' => [
            ['line_id' => 2000008802, 'amount' => 9000],
        ]]);

        $this->assertSame(450.0, $writes[2000008802]['source_transaction_rate']);
        $this->assertSame(9000.0, $writes[2000008802]['source_transaction_amount']);
    }

    public function testAnEditableDocumentIsSentBackToTheDocumentItself(): void
    {
        $this->expectException(InventoryException::class);
        $this->expectExceptionMessage('still editable');
        $this->service()->writesFor($this->migratedDispatch('DRAFT'), ['lines' => [['line_id' => 2000008801, 'rate' => 800]]]);
    }

    public function testAReversedDocumentHasNoChallanValueToRecord(): void
    {
        $this->expectException(InventoryException::class);
        $this->expectExceptionMessage('REVERSED');
        $this->service()->writesFor($this->migratedDispatch('REVERSED'), ['lines' => [['line_id' => 2000008801, 'rate' => 800]]]);
    }

    /**
     * A job-work receipt values and moves stock, and it needs no door of its own: Books' item
     * lines carried rate and amount, so one arrives from the migration already worth what its
     * challan declared, unlike a dispatch.
     */
    public function testAJobWorkReceiptIsRefused(): void
    {
        $this->expectException(InventoryException::class);
        $this->expectExceptionMessage('JOB_WORK_IN');
        $this->service()->writesFor($this->migratedDispatch('POSTED', 'JOB_WORK_IN'), ['lines' => [['line_id' => 2000008801, 'rate' => 800]]]);
    }

    public function testALineFromAnotherDocumentIsRefused(): void
    {
        $this->expectException(InventoryException::class);
        $this->expectExceptionMessage('not on this document');
        $this->service()->writesFor($this->migratedDispatch(), ['lines' => [['line_id' => 4242, 'rate' => 800]]]);
    }

    public function testAZeroValueIsRefusedRatherThanClearingADeclaredFigure(): void
    {
        $this->expectException(InventoryException::class);
        $this->expectExceptionMessage('greater than zero');
        $this->service()->writesFor($this->migratedDispatch(), ['lines' => [['line_id' => 2000008801, 'rate' => 0, 'amount' => 0]]]);
    }

    /** The operator has to be able to reach it: the route the ITC-04 warning now sends them to. */
    public function testTheEndpointIsRoutedToTheController(): void
    {
        $routes = (string) file_get_contents(__DIR__ . '/../../app/Config/Routes.php');
        $this->assertStringContainsString("inventory-documents/(:num)/challan-value', 'DocumentsController::challanValue", $routes);
        $this->assertTrue(method_exists(DocumentsController::class, 'challanValue'));
    }

    /** @var array<string, mixed>|null */
    private ?array $savedConnections = null;

    private function connectionsProperty(): \ReflectionProperty
    {
        return new \ReflectionProperty(\CodeIgniter\Database\Config::class, 'instances');
    }

    /** Hand amendChallanValue()'s \Config\Database::connect() the stub instead of a real server. */
    private function useConnection(object $db): void
    {
        $prop = $this->connectionsProperty();
        $instances = (array) $prop->getValue();
        $this->savedConnections ??= $instances;
        $instances[ENVIRONMENT === 'testing' ? 'tests' : 'default'] = $db;
        $prop->setValue(null, $instances);
    }

    protected function tearDown(): void
    {
        if ($this->savedConnections !== null) {
            $this->connectionsProperty()->setValue(null, $this->savedConnections);
            $this->savedConnections = null;
        }
        parent::tearDown();
    }

    private function amendable(AuditService $audit): DocumentService
    {
        return new class (new UnitConversionService(), $audit, new InventorySettingsService(), $this->migratedDispatch()) extends DocumentService {
            /** @param array<string, mixed> $doc */
            public function __construct(UnitConversionService $units, AuditService $audit, InventorySettingsService $settings, private array $doc)
            {
                parent::__construct($units, $audit, $settings);
            }

            /** @return array<string, mixed> */
            public function get(int $cmpId, int $documentId): array
            {
                return $this->doc;
            }
        };
    }

    /**
     * DBDebug is off on the default connection, so a refused UPDATE returns false without
     * throwing: the catch is never entered and transComplete() rolls the batch back in silence.
     * On PostgreSQL one refused line takes the rest of a multi-line challan with it. The row that
     * used to be appended after that is append-only, kept eight years, and asserts the very
     * figure Table 4 of FORM GST ITC-04 is filed on.
     */
    public function testAnAmendmentThatWasRolledBackIsNotAudited(): void
    {
        $db = new StubAbortingChallanConnection();
        $db->refuse = ['inv_document_lines'];
        $this->useConnection($db);
        $audit = new RecordingAuditService();

        $thrown = null;
        try {
            $this->amendable($audit)->amendChallanValue(7, 8801, ['lines' => [['line_id' => 2000008801, 'rate' => 800]]], 'operator-uuid');
        } catch (\Throwable $e) {
            $thrown = $e;
        }

        $this->assertSame([], $audit->entries, 'the eight-year trail must not carry a Table 4 figure no line ever took');
        $this->assertFalse($db->committed);
        $this->assertInstanceOf(\RuntimeException::class, $thrown, 'the caller was told 200 for an amendment that was rolled back');
        $this->assertStringContainsString('Could not record the challan value', $thrown->getMessage());
    }

    /** The guard must not swallow the amendment that did land. */
    public function testAnAmendmentThatCommittedIsAudited(): void
    {
        $db = new StubAbortingChallanConnection();
        $this->useConnection($db);
        $audit = new RecordingAuditService();

        $this->amendable($audit)->amendChallanValue(7, 8801, ['lines' => [['line_id' => 2000008801, 'rate' => 800]]], 'operator-uuid');

        $this->assertTrue($db->committed);
        $this->assertCount(1, $audit->entries);
        $this->assertSame('document.challan_value', $audit->entries[0]['action']);
        $this->assertSame(
            ['source_transaction_rate' => 800.0, 'source_transaction_amount' => 96000.0],
            $audit->entries[0]['after'][2000008801],
        );
    }
}
