<?php

namespace Tests\Unit;

use App\Exceptions\InventoryException;
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
use Config\DocumentTypeRegistry;
use Config\PermissionRegistry;
use PHPUnit\Framework\TestCase;

/**
 * LANDED_COST was a document type with nothing behind it.
 *
 * It was declared with valuation => true and an effect of its own, permissioned, listed by
 * GET /v1/document-types, offered in the web "new document" menu and published in the API
 * contract — and posting one marked it POSTED and changed nothing: no allocation row, no cost
 * layer raised, no average moved, no landed_cost_amount set, no effect emitted. An operator who
 * entered a freight bill to capitalise it onto a receipt was told the work was done while closing
 * stock and COGS stayed exactly where they were, and the document became the record that it had
 * been allocated.
 *
 * Nothing may be entered against a type that does nothing when it posts. The type stays declared
 * so any document already carrying it still reads back with its label, and refuses everything
 * else, until an allocator exists — and until the document carries what one needs, which this one
 * does not: no target receipt, no cost type, no allocation basis, and an amount collected in the
 * commercial source_transaction_* pair that Books owns and that may never become a cost.
 *
 * @group unit
 */
final class UnimplementedDocumentTypeTest extends TestCase
{
    private function posting(DocumentService $documents): DocumentPostingService
    {
        return new DocumentPostingService(
            $documents,
            $this->createMock(ValuationEngine::class),
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
    }

    public function testLandedCostIsTheOneTypeNothingImplements(): void
    {
        $this->assertFalse(DocumentTypeRegistry::isImplemented('LANDED_COST'));
        $this->assertFalse(DocumentTypeRegistry::isImplemented('landed_cost'));
        foreach (DocumentTypeRegistry::all() as $type) {
            if ($type === 'LANDED_COST') {
                continue;
            }
            $this->assertTrue(DocumentTypeRegistry::isImplemented($type), $type . ' does something when it posts');
        }
    }

    /** The type is still readable, so a document already carrying it keeps its label and its register row. */
    public function testTheTypeStaysDeclaredSoAnyExistingDocumentStillReadsBack(): void
    {
        $this->assertSame('Landed Cost Allocation', DocumentTypeRegistry::get('LANDED_COST')['label']);
        $this->assertTrue(DocumentTypeRegistry::isValid('LANDED_COST'));
    }

    public function testADraftOfAnUnimplementedTypeCannotBeCreated(): void
    {
        $refusal = null;
        try {
            (new DocumentService())->create(
                ['cmp_id' => 101, 'fy_id' => 5, 'bo_id' => 0],
                ['document_type' => 'LANDED_COST', 'document_date' => '2026-06-01', 'lines' => []],
                'actor-uuid',
            );
        } catch (InventoryException $e) {
            $refusal = $e;
        }

        $this->assertNotNull($refusal, 'a landed cost allocation may not be entered');
        $this->assertStringContainsString('Landed Cost Allocation', $refusal->getMessage());
        $this->assertStringContainsString('nothing happens when it posts', $refusal->getMessage());
    }

    /** A draft entered before the type was withdrawn stays a draft: POSTED would claim the allocation ran. */
    public function testADraftOfAnUnimplementedTypeCannotBePosted(): void
    {
        $documents = $this->createMock(DocumentService::class);
        $documents->method('get')->willReturn([
            'document_id' => 41, 'document_uuid' => 'u-41', 'cmp_id' => 101, 'fy_id' => 5, 'bo_id' => 0,
            'document_type' => 'LANDED_COST', 'document_date' => '2026-06-01', 'status' => 'DRAFT',
            'stock_effect' => '', 'source_app' => 'inventory', 'party_ref' => null, 'metadata' => [], 'lines' => [],
        ]);

        $refusal = null;
        try {
            $this->posting($documents)->post(101, 41, 'actor-uuid');
        } catch (\Throwable $e) {
            $refusal = $e;
        }

        $this->assertInstanceOf(InventoryException::class, $refusal, 'posting refuses the type instead of running the engine over it');
        $this->assertStringContainsString('cannot be posted', $refusal->getMessage());
    }

    /**
     * The registry publishes each type's effects to Books through the API contract, so an effect
     * declared there and emitted nowhere is a promise on a channel that can never deliver it.
     */
    public function testNoTypeDeclaresAnEffectPostingCannotEmit(): void
    {
        $source = (string) file_get_contents((string) (new \ReflectionClass(DocumentPostingService::class))->getFileName());
        preg_match_all("/'effect'\s*=>\s*'([A-Z_]+)'/", $source, $matches);
        $emitted = array_values(array_unique($matches[1]));

        $this->assertContains('STOCK_REVALUATION', $emitted, 'the revaluation effect is assembled with the rest');
        foreach (DocumentTypeRegistry::TYPES as $code => $spec) {
            foreach ($spec['effects'] as $effect) {
                $this->assertContains($effect, $emitted, $code . ' declares ' . $effect . ' and nothing emits it');
            }
        }
    }

    /** Nothing offers it: not the type catalogue, not the access profiles. */
    public function testItIsOfferedNowhere(): void
    {
        $method = new \ReflectionMethod(\App\Controllers\Api\V1\SettingsController::class, 'documentTypes');
        $source = (array) file((string) $method->getFileName());
        $body = implode('', array_slice($source, $method->getStartLine() - 1, $method->getEndLine() - $method->getStartLine() + 1));
        $this->assertStringContainsString('isImplemented(', $body, 'the type catalogue lists what a caller may work with');

        $this->assertArrayNotHasKey('landed_cost', PermissionRegistry::DOCUMENT_TYPES);
        foreach (PermissionRegistry::DOCUMENT_TYPES as $slug => $label) {
            $this->assertTrue(DocumentTypeRegistry::isImplemented($slug), $slug . ' cannot be granted; nothing implements it');
        }
    }
}
