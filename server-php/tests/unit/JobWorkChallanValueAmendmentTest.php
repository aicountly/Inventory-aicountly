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
}
