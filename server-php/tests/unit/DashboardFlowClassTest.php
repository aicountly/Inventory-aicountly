<?php

namespace Tests\Unit;

use Config\DocumentTypeRegistry;
use PHPUnit\Framework\TestCase;

/**
 * The Operations dashboard counts "receipts today" and "issues today" as documents.
 *
 * Those two counts sit side by side on the same strip, so the classification behind them has to be
 * a PARTITION: every document type in exactly one class. If a type could land in two, a stock
 * transfer would be counted as both a receipt and an issue and the day's work would read as twice
 * what it was; if a type landed in none, the day would quietly lose documents nobody could find.
 *
 * These are also the classes the valuation bridge's components are summed into, so a type slipping
 * between them would leave the bridge short by exactly that type's value.
 *
 * @group unit
 */
final class DashboardFlowClassTest extends TestCase
{
    public function testEveryDocumentTypeFallsInExactlyOneFlowClass(): void
    {
        $classes = [
            DocumentTypeRegistry::FLOW_RECEIPT,
            DocumentTypeRegistry::FLOW_ISSUE,
            DocumentTypeRegistry::FLOW_TRANSFER,
            DocumentTypeRegistry::FLOW_ADJUSTMENT,
            DocumentTypeRegistry::FLOW_NONE,
        ];

        $seen = [];
        foreach (DocumentTypeRegistry::all() as $type) {
            $flow = DocumentTypeRegistry::flowClass($type);
            $this->assertContains($flow, $classes, $type . ' has no flow class');
            $seen[$flow][] = $type;
        }

        // The partition, checked the other way round: the union of the per-class
        // lists is every type, and no type appears twice.
        $union = [];
        foreach ($classes as $flow) {
            foreach (DocumentTypeRegistry::typesInFlowClass($flow) as $type) {
                $this->assertArrayNotHasKey($type, $union, $type . ' is in more than one flow class');
                $union[$type] = $flow;
            }
        }
        $this->assertSame(
            [],
            array_diff(DocumentTypeRegistry::all(), array_keys($union)),
            'some document types are in no flow class at all',
        );
    }

    public function testATransferIsNeitherAReceiptNorAnIssue(): void
    {
        // The whole reason the class table exists: a transfer posts out of one
        // warehouse and into another in one operation, so counting it by
        // movement direction counts it twice.
        $this->assertSame(DocumentTypeRegistry::FLOW_TRANSFER, DocumentTypeRegistry::flowClass('STOCK_TRANSFER'));
        $this->assertNotContains('STOCK_TRANSFER', DocumentTypeRegistry::typesInFlowClass(DocumentTypeRegistry::FLOW_RECEIPT));
        $this->assertNotContains('STOCK_TRANSFER', DocumentTypeRegistry::typesInFlowClass(DocumentTypeRegistry::FLOW_ISSUE));
    }

    public function testGoodsArrivingAreReceiptsAndGoodsLeavingAreIssues(): void
    {
        foreach (['PURCHASE_RECEIPT', 'MATERIAL_RECEIPT', 'OPENING_STOCK', 'WRITE_IN', 'SALES_RETURN'] as $type) {
            $this->assertSame(DocumentTypeRegistry::FLOW_RECEIPT, DocumentTypeRegistry::flowClass($type), $type);
        }
        foreach (['SALES_ISSUE', 'MATERIAL_ISSUE', 'CONSUMPTION', 'WRITE_OFF', 'PURCHASE_RETURN'] as $type) {
            $this->assertSame(DocumentTypeRegistry::FLOW_ISSUE, DocumentTypeRegistry::flowClass($type), $type);
        }
    }

    public function testRevaluationAndLandedCostAreAdjustmentsNotSilentNonMovements(): void
    {
        // Both are status_only — they move no quantity — but they change the
        // VALUE of stock on hand, which is the one thing the valuation bridge
        // exists to explain. Filed under "no movement" they would vanish from
        // it and the bridge would not close.
        $this->assertSame(DocumentTypeRegistry::FLOW_ADJUSTMENT, DocumentTypeRegistry::flowClass('REVALUATION'));
        $this->assertSame(DocumentTypeRegistry::FLOW_ADJUSTMENT, DocumentTypeRegistry::flowClass('LANDED_COST'));
    }

    public function testDocumentsThatMoveNoStockAreNotCountedAsFloorWork(): void
    {
        foreach (['RESERVATION', 'RESERVATION_RELEASE', 'PACKING', 'DELIVERY_CHALLAN', 'INWARD_CHALLAN', 'JOB_WORK_OUT'] as $type) {
            $this->assertSame(DocumentTypeRegistry::FLOW_NONE, DocumentTypeRegistry::flowClass($type), $type);
        }
    }

    public function testAnUnknownTypeIsNotSilentlyCountedAsAReceipt(): void
    {
        // A type the registry does not know must not drift into a real bucket
        // and inflate a figure someone acts on.
        $this->assertSame(DocumentTypeRegistry::FLOW_NONE, DocumentTypeRegistry::flowClass('NOT_A_REAL_TYPE'));
    }

    public function testFlowClassIsCaseInsensitiveLikeTheRestOfTheRegistry(): void
    {
        $this->assertSame(
            DocumentTypeRegistry::flowClass('STOCK_TRANSFER'),
            DocumentTypeRegistry::flowClass('stock_transfer'),
        );
    }
}
