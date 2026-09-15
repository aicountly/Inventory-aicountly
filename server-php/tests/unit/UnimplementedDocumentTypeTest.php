<?php

namespace Tests\Unit;

use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use Config\DocumentTypeRegistry;
use Config\PermissionRegistry;
use PHPUnit\Framework\TestCase;

/**
 * Nothing may be entered against a document type that does nothing when it posts.
 *
 * LANDED_COST was the one type in that state, and it is what this class was written about: it was
 * declared with valuation => true, permissioned, listed by GET /v1/document-types, offered in the
 * web "new document" menu and published in the API contract — and posting one marked it POSTED and
 * changed nothing. No allocation row, no cost layer raised, no average moved, no
 * landed_cost_amount set, no effect emitted. An operator who entered a freight bill to capitalise
 * it onto a receipt was told the work was done while closing stock and COGS stayed exactly where
 * they were, and the document became the record that it had been allocated.
 *
 * It is now built, on both sides of the wire: a receipt line carries the landed cost Books
 * allocated to it and the FIFO/LIFO layer and the weighted average are both opened at the loaded
 * cost; and a LANDED_COST document allocates later-arriving charges over a posted receipt's inward
 * lines, raises the cost state, writes inv_landed_costs / inv_landed_cost_lines and emits
 * STOCK_REVALUATION. So DocumentTypeRegistry::UNIMPLEMENTED is empty.
 *
 * The invariants below are not about LANDED_COST and outlive it. They are the guard that stops the
 * NEXT type being declared, permissioned and published before anything implements it, and the
 * machinery they check (UNIMPLEMENTED, isImplemented(), the two refusals, the catalogue filter)
 * stays in place for exactly that.
 *
 * @group unit
 */
final class UnimplementedDocumentTypeTest extends TestCase
{
    public function testEveryDeclaredTypeDoesSomethingWhenItPosts(): void
    {
        $this->assertSame([], DocumentTypeRegistry::UNIMPLEMENTED, 'nothing is declared-but-unbuilt today');
        foreach (DocumentTypeRegistry::all() as $type) {
            $this->assertTrue(DocumentTypeRegistry::isImplemented($type), $type . ' does nothing when it posts');
        }
    }

    /** The type that this class was written about is built, and answers so under either spelling. */
    public function testLandedCostIsBuilt(): void
    {
        $this->assertTrue(DocumentTypeRegistry::isImplemented('LANDED_COST'));
        $this->assertTrue(DocumentTypeRegistry::isImplemented('landed_cost'));
        $this->assertSame('Landed Cost Allocation', DocumentTypeRegistry::get('LANDED_COST')['label']);
        $this->assertSame(['STOCK_REVALUATION'], DocumentTypeRegistry::get('LANDED_COST')['effects']);
        $this->assertTrue(DocumentTypeRegistry::get('LANDED_COST')['valuation']);
        $this->assertFalse(DocumentTypeRegistry::get('LANDED_COST')['cogs']);
    }

    /**
     * The two refusals are the whole mechanism, and an empty UNIMPLEMENTED list makes both of them
     * unreachable — which is exactly when a guard rots. They are asserted at the source, so
     * deleting either while the list happens to be empty is caught here rather than by the next
     * half-built type reaching production.
     */
    public function testEntryAndPostingBothStillRefuseAnUnimplementedType(): void
    {
        $create = new \ReflectionMethod(DocumentService::class, 'create');
        $createBody = self::methodSource($create);
        $this->assertStringContainsString('isImplemented(', $createBody, 'a draft of an unbuilt type may not be created');
        $this->assertStringContainsString('nothing happens when it posts', $createBody);

        $post = new \ReflectionMethod(DocumentPostingService::class, 'post');
        $postBody = self::methodSource($post);
        $this->assertStringContainsString('isImplemented(', $postBody, 'a draft entered before a type was withdrawn may not be posted');
        $this->assertStringContainsString('cannot be posted', $postBody);
    }

    /**
     * Types whose effect is produced by a hook of their own rather than by the generic assembly in
     * applyPosting(). The hook RETURNS its effect and applyPosting() appends the return value,
     * because post() persists and publishes the array applyPosting() hands back — anything written
     * straight to accounting_effects_json is overwritten before Books can read it.
     */
    private const DEDICATED_EMITTER = [
        'REVALUATION' => 'applyRevaluation',
        'LANDED_COST' => 'applyLandedCost',
    ];

    /**
     * The registry publishes each type's effects to Books through the API contract, so an effect
     * declared there and emitted nowhere is a promise on a channel that can never deliver it.
     *
     * Asked PER TYPE, at the method that emits for that type. A grep of the whole class file for
     * the literal cannot answer this: REVALUATION and LANDED_COST both declare STOCK_REVALUATION,
     * so applyRevaluation()'s copy of the literal satisfies LANDED_COST's claim as well — delete
     * the `return ['effect' => 'STOCK_REVALUATION', ...]` from applyLandedCost() and a file-wide
     * grep stays green while the type posts and publishes nothing at all. Two types sharing an
     * effect is exactly the shape that hides, so each one is checked where its own effect is made.
     */
    public function testNoTypeDeclaresAnEffectPostingCannotEmit(): void
    {
        foreach (DocumentTypeRegistry::TYPES as $code => $spec) {
            foreach ($spec['effects'] as $effect) {
                $emitter = self::DEDICATED_EMITTER[$code] ?? 'applyPosting';
                $body = self::methodSource(new \ReflectionMethod(DocumentPostingService::class, $emitter));
                $this->assertMatchesRegularExpression(
                    "/'effect'\s*=>\s*'" . preg_quote($effect, '/') . "'/",
                    $body,
                    $code . ' declares ' . $effect . ' and ' . $emitter . '() does not make one',
                );
            }
        }
    }

    /**
     * A dedicated hook has to RETURN its effect and applyPosting() has to append what it returned.
     * Writing accounting_effects_json inside the hook looks identical from the database a
     * millisecond later and is overwritten by post() before Books ever reads it — a trap this file
     * has been sprung by once already — so both halves of the channel are asserted at the source.
     */
    public function testEveryDedicatedEmitterReturnsItsEffectAndPostingAppendsIt(): void
    {
        $applyPosting = self::methodSource(new \ReflectionMethod(DocumentPostingService::class, 'applyPosting'));
        foreach (self::DEDICATED_EMITTER as $code => $method) {
            $effects = DocumentTypeRegistry::get($code)['effects'];
            $this->assertNotSame([], $effects, $code . ' has a dedicated emitter and declares no effect');
            $body = self::methodSource(new \ReflectionMethod(DocumentPostingService::class, $method));
            foreach ($effects as $effect) {
                $this->assertMatchesRegularExpression(
                    "/return[^;]*'effect'\s*=>\s*'" . preg_quote($effect, '/') . "'/s",
                    $body,
                    $method . '() must RETURN ' . $effect . ', not write it where post() will overwrite it',
                );
            }
            $this->assertMatchesRegularExpression(
                '/\\$type === \'' . preg_quote($code, '/') . '\'/',
                $applyPosting,
                'applyPosting() never dispatches to ' . $method . '() for ' . $code,
            );
            $this->assertMatchesRegularExpression(
                '/\$effects\[\] = \$' . '[A-Za-z]+;/',
                $applyPosting,
                'applyPosting() must append what the hook returned',
            );
        }
    }

    /** A permission to create what nothing can create is a promise of its own. */
    public function testNothingUnimplementedIsOfferedOrPermissioned(): void
    {
        $method = new \ReflectionMethod(\App\Controllers\Api\V1\SettingsController::class, 'documentTypes');
        $this->assertStringContainsString('isImplemented(', self::methodSource($method), 'the type catalogue lists what a caller may work with');

        foreach (PermissionRegistry::DOCUMENT_TYPES as $slug => $label) {
            $this->assertTrue(DocumentTypeRegistry::isImplemented($slug), $slug . ' cannot be granted; nothing implements it');
            $this->assertTrue(DocumentTypeRegistry::isValid($slug), $slug . ' is permissioned and is not a document type');
        }
    }

    /** A built type that nobody can be granted is the same gap from the other side. */
    public function testLandedCostIsPermissionedAgainNowThatItIsBuilt(): void
    {
        $this->assertArrayHasKey('landed_cost', PermissionRegistry::DOCUMENT_TYPES);
        $keys = PermissionRegistry::allKeys();
        foreach (PermissionRegistry::DOCUMENT_ACTIONS as $action) {
            $this->assertContains('documents.landed_cost.' . $action, $keys);
        }
        $this->assertContains('documents.landed_cost.post', PermissionRegistry::templatePermissions('inventory_manager'));
        $this->assertNotContains('documents.landed_cost.post', PermissionRegistry::templatePermissions('view_only'));
    }

    private static function methodSource(\ReflectionMethod $method): string
    {
        $source = (array) file((string) $method->getFileName());

        return implode('', array_slice($source, $method->getStartLine() - 1, $method->getEndLine() - $method->getStartLine() + 1));
    }
}
