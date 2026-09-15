<?php

namespace Tests\Integration;

use App\Exceptions\InventoryException;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\InventorySettingsService;
use Tests\Support\IntegrationTestCase;

/**
 * The company-level landed-cost capitalisation policy, enforced SERVER-SIDE at both intake points.
 *
 * The policy names which cost types this company puts into the cost of stock. Books is told which
 * ones are on so its purchase screen offers only those — but that offer is a courtesy, not the
 * control. A screen can be cached, stale, or skipped entirely by a direct API call, so Inventory
 * has to refuse an excluded type independently.
 *
 * The refusal, not a drop, is the whole point. Accepting the line and quietly leaving the amount
 * out of the valuation would be a closing stock short by exactly that amount with nobody told —
 * the same failure mode that was found by probe on a different path earlier in this project. So
 * every test below asserts BOTH halves: the call is refused, AND nothing was stored or valued.
 *
 * Both intake points are covered:
 *   - the breakdown that arrives WITH a receipt (DocumentService::normalizeLines, and again from
 *     the stored rows in DocumentPostingService::post);
 *   - the charges a LANDED_COST document carries (DocumentService::headerFromPayload, and again
 *     from the stored metadata in DocumentPostingService::applyLandedCost).
 *
 * @group integration
 */
final class LandedCostPolicyEnforcementTest extends IntegrationTestCase
{
    private DocumentService $docs;
    private DocumentPostingService $posting;
    private InventorySettingsService $settings;
    private int $pcs;
    private int $wh;
    private int $item;

    protected function setUp(): void
    {
        parent::setUp();
        $this->docs = new DocumentService();
        $this->posting = new DocumentPostingService($this->docs);
        $this->settings = new InventorySettingsService();
        $this->pcs = $this->makeUnit();
        $this->wh = $this->makeWarehouse();
        $this->item = $this->makeItem('Imported widget', $this->pcs, 'FIFO');
    }

    /** Set the policy the way the settings endpoint does, and clear the per-company cache. */
    private function exclude(array $types): void
    {
        $this->settings->update($this->cmpId, ['landed_cost_excluded_types' => $types], 'tester');
        InventorySettingsService::flush();
    }

    /** @param list<array<string, mixed>> $breakdown */
    private function receiptPayload(int $sourceId, float $amount, array $breakdown): array
    {
        $line = ['item_id' => $this->item, 'warehouse_id' => $this->wh, 'unit_id' => $this->pcs, 'qty' => 10, 'rate' => 100, 'amount' => 1000, 'landed_cost_amount' => $amount];
        if ($breakdown !== []) {
            $line['landed_cost_breakdown'] = $breakdown;
        }

        return [
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-10',
            'source_document_type' => 'books.purchase', 'source_document_id' => $sourceId, 'source_document_no' => 'P-' . $sourceId,
            'lines' => [$line],
        ];
    }

    private function landedCostPayload(int $targetId, array $charges): array
    {
        return [
            'document_type' => 'LANDED_COST', 'document_date' => '2026-04-18',
            'metadata' => ['target_document_id' => $targetId, 'charges' => $charges],
        ];
    }

    private function refusal(callable $fn): InventoryException
    {
        try {
            $fn();
        } catch (InventoryException $e) {
            return $e;
        }
        $this->fail('expected a validation refusal');
    }

    private function postedReceipt(int $sourceId = 900): array
    {
        $doc = $this->docs->create($this->ctx(), $this->receiptPayload($sourceId, 0.0, []), 'tester', 'books');

        return $this->posting->post($this->cmpId, (int) $doc['document_id'], 'tester', ['session' => ['kind' => 'service']]);
    }

    // ------------------------------------------------------------------ the default

    /**
     * Nothing changes for a company that has never touched the policy. This is the guard on the
     * whole feature: an existing deployment must post exactly what it posted yesterday.
     */
    public function testByDefaultEveryCostTypeIsCapitalised(): void
    {
        $this->assertSame(
            ['freight', 'duty', 'insurance', 'handling', 'other', 'non_creditable_tax'],
            $this->settings->capitalisableLandedCostTypes($this->cmpId),
        );
        $this->assertSame([], $this->settings->excludedLandedCostTypes($this->cmpId));

        $doc = $this->docs->create($this->ctx(), $this->receiptPayload(901, 250.0, [
            ['cost_type' => 'freight', 'amount' => 150.0, 'allocation_basis' => 'value'],
            ['cost_type' => 'duty', 'amount' => 60.0, 'allocation_basis' => 'qty'],
            ['cost_type' => 'non_creditable_tax', 'amount' => 40.0, 'allocation_basis' => 'direct'],
        ]), 'tester', 'books');
        $posted = $this->posting->post($this->cmpId, (int) $doc['document_id'], 'tester', ['session' => ['kind' => 'service']]);

        $this->assertSame('POSTED', $posted['status']);
        $this->assertEqualsWithDelta(125.0, $posted['lines'][0]['valuation_rate'], 0.0001, '100 of goods + 25 a unit of landing');
        $this->assertEqualsWithDelta(250.0, $posted['lines'][0]['landed_cost_amount'], 0.0001);
    }

    // ------------------------------------------------------------------ intake one: the receipt-borne breakdown

    public function testAnExcludedTypeOnAReceiptLineIsRefusedAndNothingIsStored(): void
    {
        $this->exclude(['freight']);

        $e = $this->refusal(fn () => $this->docs->create($this->ctx(), $this->receiptPayload(902, 250.0, [
            ['cost_type' => 'freight', 'amount' => 150.0, 'allocation_basis' => 'value'],
            ['cost_type' => 'duty', 'amount' => 100.0, 'allocation_basis' => 'qty'],
        ]), 'tester', 'books'));

        $this->assertSame('validation_failed', $e->errorCode());
        $this->assertSame(422, $e->httpStatus());
        $this->assertStringContainsString('freight', $e->getMessage(), 'the refusal names the type');
        $this->assertStringContainsString('does not capitalise', $e->getMessage(), 'and names the policy');
        $this->assertSame('freight', $e->details()['cost_type'] ?? null);
        $this->assertNotContains('freight', $e->details()['capitalisable_cost_types'] ?? []);

        // The other half of the promise: the cost was not accepted and quietly dropped.
        $this->assertSame(0, $this->db->table('inv_documents')->where('cmp_id', $this->cmpId)->where('source_document_id', 902)->countAllResults());
        $this->assertSame(0, $this->db->table('inv_document_lines')->where('cmp_id', $this->cmpId)->countAllResults());
    }

    /**
     * The switched-on types still work while a sibling is off, so the refusal is the policy and
     * not a blanket "landed cost is broken now".
     */
    public function testTheSwitchedOnTypesStillPostWhileAnotherIsOff(): void
    {
        $this->exclude(['freight']);

        $doc = $this->docs->create($this->ctx(), $this->receiptPayload(903, 100.0, [
            ['cost_type' => 'duty', 'amount' => 60.0, 'allocation_basis' => 'qty'],
            ['cost_type' => 'non_creditable_tax', 'amount' => 40.0, 'allocation_basis' => 'direct'],
        ]), 'tester', 'books');
        $posted = $this->posting->post($this->cmpId, (int) $doc['document_id'], 'tester', ['session' => ['kind' => 'service']]);

        $this->assertSame('POSTED', $posted['status']);
        $this->assertEqualsWithDelta(110.0, $posted['lines'][0]['valuation_rate'], 0.0001);
    }

    /**
     * A bare amount is capitalised as 'other', so a company that switched 'other' off has to be
     * told rather than have an unnamed charge booked under the very type it excluded.
     */
    public function testAnUnBrokenDownAmountIsRefusedWhenOtherIsOff(): void
    {
        $this->exclude(['other']);

        $e = $this->refusal(fn () => $this->docs->create($this->ctx(), $this->receiptPayload(904, 250.0, []), 'tester', 'books'));

        $this->assertStringContainsString('no breakdown', $e->getMessage());
        $this->assertSame(0, $this->db->table('inv_documents')->where('cmp_id', $this->cmpId)->countAllResults());
    }

    /**
     * The defence in depth that makes the policy more than an entry-screen rule: a draft saved
     * while freight was capitalisable, posted after it was switched off. Entry never runs again on
     * this path, so posting has to ask the stored rows — and posting is where the amount would
     * actually reach the cost layer and the weighted average.
     */
    public function testADraftSavedUnderTheOldPolicyIsRefusedAtPosting(): void
    {
        $doc = $this->docs->create($this->ctx(), $this->receiptPayload(905, 250.0, [
            ['cost_type' => 'freight', 'amount' => 250.0, 'allocation_basis' => 'value'],
        ]), 'tester', 'books');
        $documentId = (int) $doc['document_id'];

        $this->exclude(['freight']);

        $e = $this->refusal(fn () => $this->posting->post($this->cmpId, $documentId, 'tester', ['session' => ['kind' => 'service']]));
        $this->assertStringContainsString('freight', $e->getMessage());

        $stored = $this->db->table('inv_documents')->where('document_id', $documentId)->get()->getRowArray();
        $this->assertNotSame('POSTED', $stored['status'], 'a refused posting does not mark the document posted');
        $this->assertSame(0, $this->db->table('inv_cost_layers')->where('cmp_id', $this->cmpId)->countAllResults(), 'and no layer was opened at a cost the policy forbids');
        $this->assertSame(0, $this->db->table('inv_stock_movements')->where('cmp_id', $this->cmpId)->countAllResults());
    }

    // ------------------------------------------------------------------ intake two: the LANDED_COST document

    public function testAnExcludedChargeOnALandedCostDocumentIsRefusedAtEntry(): void
    {
        $receipt = $this->postedReceipt(906);
        $this->exclude(['insurance']);

        $e = $this->refusal(fn () => $this->docs->create($this->ctx(), $this->landedCostPayload((int) $receipt['document_id'], [
            ['cost_type' => 'insurance', 'amount' => 400.0, 'allocation_basis' => 'value'],
        ]), 'tester', 'books'));

        $this->assertSame('validation_failed', $e->errorCode());
        $this->assertStringContainsString('insurance', $e->getMessage());
        $this->assertStringContainsString('Charge 1', $e->getMessage());
        $this->assertSame(1, $this->db->table('inv_documents')->where('cmp_id', $this->cmpId)->countAllResults(), 'only the receipt exists; no allocation document was written');
    }

    /**
     * And from the STORED metadata at posting, for the same reason as the receipt draft: the
     * allocation is where the charge actually raises the layer and the average.
     */
    public function testAnExcludedChargeIsRefusedAgainAtPostingFromStoredMetadata(): void
    {
        $receipt = $this->postedReceipt(907);
        $allocation = $this->docs->create($this->ctx(), $this->landedCostPayload((int) $receipt['document_id'], [
            ['cost_type' => 'handling', 'amount' => 400.0, 'allocation_basis' => 'value'],
        ]), 'tester', 'books');
        $allocationId = (int) $allocation['document_id'];

        $this->exclude(['handling']);

        $e = $this->refusal(fn () => $this->posting->post($this->cmpId, $allocationId, 'tester', ['session' => ['kind' => 'service']]));
        $this->assertStringContainsString('handling', $e->getMessage());

        $line = $this->db->table('inv_document_lines')->where('document_id', (int) $receipt['document_id'])->get()->getRowArray();
        $this->assertEqualsWithDelta(100.0, (float) $line['valuation_rate'], 0.0001, 'the receipt was not raised by a charge the policy excludes');
        $this->assertSame(0, $this->db->table('inv_landed_costs')->where('document_id', $allocationId)->countAllResults(), 'and no allocation detail was written');
    }

    /**
     * One excluded charge refuses the WHOLE allocation. Skipping it and allocating the rest would
     * leave part of a bill nowhere, silently — the drop this design refuses to make.
     */
    public function testOneExcludedChargeRefusesTheWholeAllocation(): void
    {
        $receipt = $this->postedReceipt(908);
        $this->exclude(['freight']);

        $this->refusal(fn () => $this->docs->create($this->ctx(), $this->landedCostPayload((int) $receipt['document_id'], [
            ['cost_type' => 'duty', 'amount' => 300.0, 'allocation_basis' => 'value'],
            ['cost_type' => 'freight', 'amount' => 100.0, 'allocation_basis' => 'value'],
        ]), 'tester', 'books'));

        $line = $this->db->table('inv_document_lines')->where('document_id', (int) $receipt['document_id'])->get()->getRowArray();
        $this->assertEqualsWithDelta(100.0, (float) $line['valuation_rate'], 0.0001, 'the duty did not land on its own');
    }

    // ------------------------------------------------------------------ the type that is not a switch

    public function testNonCreditableTaxCannotBeExcludedThroughTheSettingsService(): void
    {
        $e = $this->refusal(fn () => $this->settings->update($this->cmpId, ['landed_cost_excluded_types' => ['non_creditable_tax']], 'tester'));

        $this->assertStringContainsString('AS-2', $e->getMessage());
        InventorySettingsService::flush();
        $this->assertSame([], $this->settings->excludedLandedCostTypes($this->cmpId), 'a refused patch stores nothing');
        $this->assertContains('non_creditable_tax', $this->settings->capitalisableLandedCostTypes($this->cmpId));
    }

    /** Every switchable type off, and a non-creditable tax still reaches the cost of the goods. */
    public function testNonCreditableTaxStillCapitalisesWithEveryOtherTypeOff(): void
    {
        $this->exclude(InventorySettingsService::LANDED_COST_SWITCHABLE_TYPES);
        $this->assertSame(['non_creditable_tax'], $this->settings->capitalisableLandedCostTypes($this->cmpId));

        $doc = $this->docs->create($this->ctx(), $this->receiptPayload(909, 134.56, [
            ['cost_type' => 'non_creditable_tax', 'amount' => 134.56, 'allocation_basis' => 'direct'],
        ]), 'tester', 'books');
        $posted = $this->posting->post($this->cmpId, (int) $doc['document_id'], 'tester', ['session' => ['kind' => 'service']]);

        $this->assertSame('POSTED', $posted['status']);
        $this->assertEqualsWithDelta(1134.56, $posted['lines'][0]['valuation_amount'], 0.01);
    }

    // ------------------------------------------------------------------ what Books is handed

    public function testThePolicyIsReadableAsASetForTheCallerThatOffersTheTypes(): void
    {
        $this->exclude(['freight', 'other']);

        $this->assertSame([
            'capitalisable_cost_types'      => ['duty', 'insurance', 'handling', 'non_creditable_tax'],
            'excluded_cost_types'           => ['freight', 'other'],
            'switchable_cost_types'         => ['freight', 'duty', 'insurance', 'handling', 'other'],
            'always_capitalised_cost_types' => ['non_creditable_tax'],
            'all_cost_types'                => ['freight', 'duty', 'insurance', 'handling', 'other', 'non_creditable_tax'],
        ], $this->settings->landedCostPolicy($this->cmpId));
    }

    /** Stored as one ordered, de-duplicated string, whatever order the screen sent the boxes in. */
    public function testThePolicyIsStoredNormalised(): void
    {
        $this->exclude(['other', 'freight', 'freight']);

        $row = $this->db->table('inv_company_settings')->where('cmp_id', $this->cmpId)->get()->getRowArray();
        $this->assertSame('freight,other', $row['landed_cost_excluded_types']);
    }

    public function testThePolicyCanBeClearedBackToCapitalisingEverything(): void
    {
        $this->exclude(['freight', 'duty']);
        $this->exclude([]);

        $row = $this->db->table('inv_company_settings')->where('cmp_id', $this->cmpId)->get()->getRowArray();
        $this->assertSame('', $row['landed_cost_excluded_types']);
        $this->assertSame([], $this->settings->excludedLandedCostTypes($this->cmpId));
        $this->assertSame(DocumentService::LANDED_COST_TYPES, $this->settings->capitalisableLandedCostTypes($this->cmpId));
    }
}
