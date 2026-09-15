<?php

namespace Tests\Integration;

use App\Exceptions\InventoryException;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\RecalculationService;
use Tests\Support\IntegrationTestCase;

/**
 * LANDED_COST: charges that arrive AFTER the receipt.
 *
 * The freight bill turns up a week after the goods. The document names the posted receipt and the
 * charges; posting spreads each charge over the receipt's inward lines on the basis chosen, raises
 * the cost layers still holding that stock, re-averages the weighted average, writes the allocation
 * detail and hands Books a STOCK_REVALUATION effect to journal.
 *
 * Two things it deliberately does not do, both asserted here because leaving either unstated is
 * worse than the limitation itself:
 *   - stock already ISSUED out of the target receipt is not retro-costed; the unabsorbed remainder
 *     comes back as a `landed_cost_not_absorbed` warning naming the amount;
 *   - the document cannot be reversed, because reversing it would report that the cost had been
 *     taken back off the stock while every layer it raised stayed raised.
 *
 * @group integration
 */
final class LandedCostDocumentTest extends IntegrationTestCase
{
    private DocumentService $docs;
    private DocumentPostingService $posting;
    private int $pcs;
    private int $wh;

    protected function setUp(): void
    {
        parent::setUp();
        $this->docs = new DocumentService();
        $this->posting = new DocumentPostingService($this->docs);
        $this->pcs = $this->makeUnit();
        $this->wh = $this->makeWarehouse();
    }

    private function postDoc(array $payload, string $source = 'inventory'): array
    {
        $doc = $this->docs->create($this->ctx(), $payload, 'tester', $source);

        return $this->posting->post($this->cmpId, (int) $doc['document_id'], 'tester', ['session' => ['kind' => 'service']]);
    }

    /** A receipt of two items: 10 @ 100 = 1000, and 10 @ 300 = 3000. */
    private function receipt(int $a, int $b, int $sourceId = 901): array
    {
        return $this->postDoc([
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-10',
            'source_document_type' => 'books.purchase', 'source_document_id' => $sourceId, 'source_document_no' => 'P-' . $sourceId,
            'lines' => [
                ['item_id' => $a, 'warehouse_id' => $this->wh, 'unit_id' => $this->pcs, 'qty' => 10, 'rate' => 100, 'amount' => 1000],
                ['item_id' => $b, 'warehouse_id' => $this->wh, 'unit_id' => $this->pcs, 'qty' => 10, 'rate' => 300, 'amount' => 3000],
            ],
        ], 'books');
    }

    private function landedCost(int $targetId, array $charges, string $date = '2026-04-18'): array
    {
        return $this->postDoc([
            'document_type' => 'LANDED_COST', 'document_date' => $date,
            'metadata' => ['target_document_id' => $targetId, 'charges' => $charges],
        ]);
    }

    /**
     * The effects come back through the document read, so the amount is whatever JSON made of it.
     * What matters is the effect and the figure.
     *
     * @param list<array<string, mixed>> $effects
     */
    private function assertRevaluationEffect(array $effects, float $amount): void
    {
        $this->assertCount(1, $effects, 'one landed cost allocation, one effect');
        $this->assertSame('STOCK_REVALUATION', $effects[0]['effect']);
        $this->assertEqualsWithDelta($amount, (float) $effects[0]['amount'], 0.0001);
    }

    private function line(int $lineId): array
    {
        return $this->db->table('inv_document_lines')->where('line_id', $lineId)->get()->getRowArray();
    }

    // ------------------------------------------------------------------ allocation

    /** By value: 400 of freight over lines worth 1000 and 3000 is 100 and 300. */
    public function testAChargeIsAllocatedByValueAndRaisesBothLines(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $b = $this->makeItem('Dear', $this->pcs, 'FIFO');
        $receipt = $this->receipt($a, $b);
        [$lineA, $lineB] = $receipt['lines'];

        $doc = $this->landedCost((int) $receipt['document_id'], [
            ['cost_type' => 'freight', 'amount' => 400, 'allocation_basis' => 'value', 'description' => 'Road freight'],
        ]);

        $this->assertSame('POSTED', $doc['status']);
        $this->assertRevaluationEffect($doc['accounting_effects'], 400.0);

        $a1 = $this->line((int) $lineA['line_id']);
        $this->assertEqualsWithDelta(1100.0, (float) $a1['valuation_amount'], 0.0001);
        $this->assertEqualsWithDelta(110.0, (float) $a1['valuation_rate'], 0.0001);
        $this->assertEqualsWithDelta(100.0, (float) $a1['landed_cost_amount'], 0.0001);
        $this->assertEqualsWithDelta(100.0, (float) $a1['source_transaction_rate'], 0.0001, 'Books owns the invoice rate and it did not move');

        $b1 = $this->line((int) $lineB['line_id']);
        $this->assertEqualsWithDelta(3300.0, (float) $b1['valuation_amount'], 0.0001);
        $this->assertEqualsWithDelta(330.0, (float) $b1['valuation_rate'], 0.0001);

        $layers = $this->db->table('inv_cost_layers')->whereIn('source_line_id', [(int) $lineA['line_id'], (int) $lineB['line_id']])->orderBy('layer_id')->get()->getResultArray();
        $this->assertEqualsWithDelta(110.0, (float) $layers[0]['unit_cost'], 0.0001, 'the layer still holding the goods is re-priced');
        $this->assertEqualsWithDelta(330.0, (float) $layers[1]['unit_cost'], 0.0001);
    }

    /** By quantity: equal quantities take equal shares whatever the lines are worth. */
    public function testAChargeIsAllocatedByQuantity(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $b = $this->makeItem('Dear', $this->pcs, 'FIFO');
        $receipt = $this->receipt($a, $b);
        [$lineA, $lineB] = $receipt['lines'];

        $this->landedCost((int) $receipt['document_id'], [['cost_type' => 'duty', 'amount' => 400, 'allocation_basis' => 'qty']]);

        $this->assertEqualsWithDelta(200.0, (float) $this->line((int) $lineA['line_id'])['landed_cost_amount'], 0.0001);
        $this->assertEqualsWithDelta(200.0, (float) $this->line((int) $lineB['line_id'])['landed_cost_amount'], 0.0001);
    }

    /** Direct: a non-creditable tax belongs to the one line whose tax it is. */
    public function testADirectChargeSitsOnItsOneLine(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $b = $this->makeItem('Dear', $this->pcs, 'FIFO');
        $receipt = $this->receipt($a, $b);
        [$lineA, $lineB] = $receipt['lines'];

        $this->landedCost((int) $receipt['document_id'], [
            ['cost_type' => 'non_creditable_tax', 'amount' => 134.56, 'allocation_basis' => 'direct', 'lines' => [['line_id' => (int) $lineB['line_id'], 'amount' => 134.56]]],
        ]);

        $this->assertEqualsWithDelta(0.0, (float) $this->line((int) $lineA['line_id'])['landed_cost_amount'], 0.0001);
        $this->assertEqualsWithDelta(134.56, (float) $this->line((int) $lineB['line_id'])['landed_cost_amount'], 0.0001);
    }

    public function testSeveralChargesOnDifferentBasesAreAllAllocated(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $b = $this->makeItem('Dear', $this->pcs, 'FIFO');
        $receipt = $this->receipt($a, $b);
        [$lineA, $lineB] = $receipt['lines'];

        $doc = $this->landedCost((int) $receipt['document_id'], [
            ['cost_type' => 'freight', 'amount' => 400, 'allocation_basis' => 'value'],
            ['cost_type' => 'duty', 'amount' => 200, 'allocation_basis' => 'qty'],
            ['cost_type' => 'handling', 'amount' => 100, 'allocation_basis' => 'manual', 'lines' => [
                ['line_id' => (int) $lineA['line_id'], 'amount' => 75],
                ['line_id' => (int) $lineB['line_id'], 'amount' => 25],
            ]],
        ]);

        // A: 100 + 100 + 75 = 275. B: 300 + 100 + 25 = 425. Total 700.
        $this->assertEqualsWithDelta(275.0, (float) $this->line((int) $lineA['line_id'])['landed_cost_amount'], 0.0001);
        $this->assertEqualsWithDelta(425.0, (float) $this->line((int) $lineB['line_id'])['landed_cost_amount'], 0.0001);
        $this->assertRevaluationEffect($doc['accounting_effects'], 700.0);

        $costs = $this->db->table('inv_landed_costs')->where('document_id', (int) $doc['document_id'])->orderBy('cost_type')->get()->getResultArray();
        $this->assertCount(3, $costs);
        foreach ($costs as $row) {
            $this->assertSame((int) $receipt['document_id'], (int) $row['target_document_id'], 'the detail points back at the receipt it loaded');
            $this->assertNotSame((int) $receipt['document_id'], (int) $row['document_id'], 'and at the landed cost document that did it');
        }
        $this->assertSame(6, $this->db->table('inv_landed_cost_lines')->countAllResults(), 'three charges over two lines');
        $perUnit = $this->db->table('inv_landed_cost_lines l')->select('l.per_unit_amount')
            ->join('inv_landed_costs c', 'c.landed_cost_id = l.landed_cost_id')
            ->where('c.cost_type', 'freight')->where('l.target_line_id', (int) $lineA['line_id'])->get()->getRowArray();
        $this->assertEqualsWithDelta(10.0, (float) $perUnit['per_unit_amount'], 0.0001, '100 over 10 units');
    }

    /** The weighted average takes the uplift on what it holds, the same as a FIFO layer. */
    public function testTheWeightedAverageIsRaisedToo(): void
    {
        $a = $this->makeItem('Averaged', $this->pcs, 'WAC');
        $b = $this->makeItem('Averaged two', $this->pcs, 'WAC');
        $receipt = $this->receipt($a, $b);

        $doc = $this->landedCost((int) $receipt['document_id'], [['cost_type' => 'freight', 'amount' => 400, 'allocation_basis' => 'value']]);

        $stateA = $this->db->table('inv_wac_state')->where('item_id', $a)->get()->getRowArray();
        $this->assertEqualsWithDelta(110.0, (float) $stateA['average_cost'], 0.0001);
        $stateB = $this->db->table('inv_wac_state')->where('item_id', $b)->get()->getRowArray();
        $this->assertEqualsWithDelta(330.0, (float) $stateB['average_cost'], 0.0001);
        $this->assertRevaluationEffect($doc['accounting_effects'], 400.0);
    }

    /**
     * The effect has to be IN the array applyPosting() returns: post() persists
     * accounting_effects_json and publishes the outbox payload from that array, in the same
     * transaction, so anything written straight to the column is overwritten before Books can read
     * it. Both ends of the channel are checked, because that trap has been sprung here once before.
     */
    public function testTheRevaluationEffectReachesBooksOnBothChannels(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $b = $this->makeItem('Dear', $this->pcs, 'FIFO');
        $receipt = $this->receipt($a, $b);

        $doc = $this->landedCost((int) $receipt['document_id'], [['cost_type' => 'freight', 'amount' => 400, 'allocation_basis' => 'value']]);

        $stored = json_decode((string) $this->db->table('inv_documents')->where('document_id', (int) $doc['document_id'])->get()->getRowArray()['accounting_effects_json'], true);
        $this->assertRevaluationEffect($stored, 400.0);

        $event = $this->db->table('inv_integration_events')->where('event_type', 'inventory.document.posted')->where('aggregate_id', (int) $doc['document_id'])->get()->getRowArray();
        $this->assertNotNull($event, 'the posting was published');
        $payload = json_decode((string) $event['payload_json'], true);
        $this->assertSame('LANDED_COST', $payload['document_type']);
        $this->assertRevaluationEffect($payload['accounting_effects'], 400.0);
    }

    /** Posting nothing onto stock that costs nothing more is not an accounting event. */
    public function testAChargeThatMovesNothingEmitsNothing(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $b = $this->makeItem('Dear', $this->pcs, 'FIFO');
        $receipt = $this->receipt($a, $b);
        // Everything received is issued out again, so nothing is left on hand to absorb the charge.
        foreach ($receipt['lines'] as $l) {
            $this->postDoc([
                'document_type' => 'MATERIAL_ISSUE', 'document_date' => '2026-04-12',
                'lines' => [['item_id' => (int) $l['item_id'], 'warehouse_id' => $this->wh, 'unit_id' => $this->pcs, 'qty' => 10]],
            ]);
        }

        $doc = $this->landedCost((int) $receipt['document_id'], [['cost_type' => 'freight', 'amount' => 400, 'allocation_basis' => 'value']]);

        $this->assertSame([], $doc['accounting_effects'], 'nothing moved, so there is nothing to tell Books');
        $codes = array_column($doc['warnings'], 'code');
        $this->assertContains('landed_cost_not_absorbed', $codes);
    }

    /**
     * The partially-issued case, which is the one this v1 is honest about: half the receipt has been
     * sold, so only half the freight can be capitalised and the other half is reported rather than
     * quietly left as a COGS difference nobody was told about.
     */
    public function testAPartlyIssuedReceiptReportsTheUnabsorbedRemainder(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $b = $this->makeItem('Dear', $this->pcs, 'FIFO');
        $receipt = $this->receipt($a, $b);
        // 5 of the 10 units of the first item are issued.
        $this->postDoc([
            'document_type' => 'MATERIAL_ISSUE', 'document_date' => '2026-04-12',
            'lines' => [['item_id' => $a, 'warehouse_id' => $this->wh, 'unit_id' => $this->pcs, 'qty' => 5]],
        ]);

        $doc = $this->landedCost((int) $receipt['document_id'], [['cost_type' => 'freight', 'amount' => 400, 'allocation_basis' => 'value']]);

        // A takes 100 (10 a unit) but holds 5 units, so it absorbs 50; B absorbs all 300.
        $this->assertRevaluationEffect($doc['accounting_effects'], 350.0);
        $warning = null;
        foreach ($doc['warnings'] as $w) {
            if ($w['code'] === 'landed_cost_not_absorbed') {
                $warning = $w;
            }
        }
        $this->assertNotNull($warning, 'the remainder is never left unstated');
        $this->assertEqualsWithDelta(50.0, (float) $warning['details']['unabsorbed'], 0.0001);
        $this->assertEqualsWithDelta(400.0, (float) $warning['details']['charge_total'], 0.0001);
        $this->assertStringContainsString('already been issued', $warning['message']);

        // The line records what was ABSORBED — 50 — and not the 100 that was allocated to it.
        //
        // The other 50 belongs to units that have already gone to COGS, and the warning above is
        // the instruction to expense it. Stamping it on the line as well would be the same rupees
        // told twice: RecalculationService::decidedInwardUnitCost() prefers the stored line rate,
        // so the next replay covering this date would re-price the five units already issued at
        // the raised rate and push the expensed remainder into COGS a second time; and
        // ReconciliationService::lineValuationEffectSql() sums l.valuation_amount per document, so
        // /v1/reconciliation would report 50 of stock value that no cost layer backs.
        $line = $this->line((int) $receipt['lines'][0]['line_id']);
        $this->assertEqualsWithDelta(50.0, (float) $line['landed_cost_amount'], 0.0001);
        $this->assertEqualsWithDelta(1050.0, (float) $line['valuation_amount'], 0.0001);
        $this->assertEqualsWithDelta(105.0, (float) $line['valuation_rate'], 0.0001);

        // ...and that total is exactly what the books hold: what has gone to COGS plus what the
        // layer still carries. 5 issued at 100 = 500, plus 5 remaining at 110 = 550.
        $layer = $this->db->table('inv_cost_layers')->where('source_line_id', (int) $line['line_id'])->get()->getRowArray();
        $this->assertEqualsWithDelta(110.0, (float) $layer['unit_cost'], 0.0001, 'the units still here really do cost 110');
        $cogs = (float) $this->db->table('inv_cost_layer_consumptions')->selectSum('qty', 'q')->get()->getRowArray()['q'] * 100.0;
        $this->assertEqualsWithDelta(
            (float) $line['valuation_amount'],
            $cogs + ((float) $layer['qty_remaining'] * (float) $layer['unit_cost']),
            0.0001,
            'the line ties to COGS + what the layers hold, which is what makes reconciliation tie',
        );
    }

    /**
     * The fully-issued case, and the reason the line may not carry what was not absorbed.
     *
     * The document tells the operator, in a warning, to expense the whole charge. If it ALSO
     * stamped the raised rate on the receipt line, the very next replay covering that date would
     * re-price the units already sold from it and push the same 500 into COGS — expensed once in
     * Books and costed once here, against an instruction this system itself issued.
     */
    public function testWhatWasNotAbsorbedIsNeverAlsoStampedOnTheReceiptLine(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $b = $this->makeItem('Dear', $this->pcs, 'FIFO');
        $receipt = $this->receipt($a, $b);
        $sale = $this->postDoc([
            'document_type' => 'SALES_ISSUE', 'document_date' => '2026-04-12', 'source_document_type' => 'books.sales', 'source_document_id' => 951, 'source_document_no' => 'S-1',
            'lines' => [['item_id' => $a, 'warehouse_id' => $this->wh, 'unit_id' => $this->pcs, 'qty' => 10, 'rate' => 300, 'amount' => 3000]],
        ], 'books');
        $saleLineId = (int) $sale['lines'][0]['line_id'];
        $this->assertEqualsWithDelta(1000.0, (float) $this->line($saleLineId)['valuation_amount'], 0.0001);

        $doc = $this->landedCost((int) $receipt['document_id'], [
            ['cost_type' => 'freight', 'amount' => 500, 'allocation_basis' => 'manual', 'lines' => [['line_id' => (int) $receipt['lines'][0]['line_id'], 'amount' => 500]]],
        ]);

        $this->assertSame([], $doc['accounting_effects'], 'nothing was capitalised, so Books is told of nothing');
        $this->assertContains('landed_cost_not_absorbed', array_column($doc['warnings'], 'code'));

        $line = $this->line((int) $receipt['lines'][0]['line_id']);
        $this->assertEqualsWithDelta(0.0, (float) $line['landed_cost_amount'], 0.0001);
        $this->assertEqualsWithDelta(1000.0, (float) $line['valuation_amount'], 0.0001, 'the receipt line is left exactly where it was');
        $this->assertEqualsWithDelta(100.0, (float) $line['valuation_rate'], 0.0001);

        // The proof: a replay over that date changes nothing, so the 500 the operator was told to
        // expense cannot also arrive in COGS.
        $svc = new RecalculationService();
        $job = $svc->run($svc->enqueue($this->cmpId, $this->fyId, $a, '2026-04-10', 'manual', null, 'tester'));
        $this->assertSame('COMPLETED', $job['status']);
        $this->assertEqualsWithDelta(1000.0, (float) $this->line($saleLineId)['valuation_amount'], 0.0001, 'COGS did not move');
        $this->assertEqualsWithDelta(0.0, (float) $job['cogs_delta'], 0.0001);
    }

    /**
     * The same business facts under either valuation method capitalise the same rupees.
     *
     * Receipt A brings 10 units, 9 are sold, an unrelated receipt B brings 10 more, and 500 of
     * freight is then allocated to A. Only one of A's units is still here, so only 50 of the
     * freight can be capitalised whichever way the item is valued. FIFO reads that off A's own
     * layer. The weighted average keeps no layer, and capping the uplift at the ITEM's quantity on
     * hand — which is what "on hand" means to a pool — let the charge load in full onto another
     * supplier's goods: 500 absorbed instead of 50, an accounting effect ten times the FIFO one,
     * closing stock overstated by 450, and the landed_cost_not_absorbed warning silent.
     */
    public function testWacAndFifoAbsorbTheSameChargeOnTheSameFacts(): void
    {
        $results = [];
        $sourceId = 960;
        foreach (['FIFO', 'WAC'] as $method) {
            $item = $this->makeItem('Widget ' . $method, $this->pcs, $method);
            $a = $this->postDoc([
                'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-10', 'source_document_type' => 'books.purchase', 'source_document_id' => ++$sourceId, 'source_document_no' => 'A-' . $method,
                'lines' => [['item_id' => $item, 'warehouse_id' => $this->wh, 'unit_id' => $this->pcs, 'qty' => 10, 'rate' => 100, 'amount' => 1000]],
            ], 'books');
            $this->postDoc([
                'document_type' => 'MATERIAL_ISSUE', 'document_date' => '2026-04-11',
                'lines' => [['item_id' => $item, 'warehouse_id' => $this->wh, 'unit_id' => $this->pcs, 'qty' => 9]],
            ]);
            $this->postDoc([
                'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-12', 'source_document_type' => 'books.purchase', 'source_document_id' => ++$sourceId, 'source_document_no' => 'B-' . $method,
                'lines' => [['item_id' => $item, 'warehouse_id' => $this->wh, 'unit_id' => $this->pcs, 'qty' => 10, 'rate' => 200, 'amount' => 2000]],
            ], 'books');

            $doc = $this->landedCost((int) $a['document_id'], [['cost_type' => 'freight', 'amount' => 500, 'allocation_basis' => 'value']]);
            $warning = null;
            foreach ($doc['warnings'] as $w) {
                if ($w['code'] === 'landed_cost_not_absorbed') {
                    $warning = $w;
                }
            }
            $this->assertNotNull($warning, $method . ' must report what it could not absorb');
            $results[$method] = [
                'effect'     => $doc['accounting_effects'] === [] ? 0.0 : round((float) $doc['accounting_effects'][0]['amount'], 4),
                'absorbed'   => round((float) $warning['details']['absorbed'], 4),
                'unabsorbed' => round((float) $warning['details']['unabsorbed'], 4),
                'line'       => round((float) $this->line((int) $a['lines'][0]['line_id'])['landed_cost_amount'], 4),
            ];
        }

        $this->assertSame($results['FIFO'], $results['WAC'], 'the valuation method may not change how much freight is capitalised');
        $this->assertEqualsWithDelta(50.0, $results['FIFO']['effect'], 0.0001, 'one unit of the ten is still here, so 50 of the 500');
        $this->assertEqualsWithDelta(450.0, $results['FIFO']['unabsorbed'], 0.0001);
    }

    /**
     * A receipt inside a locked period may not be loaded at all.
     *
     * The lock is the mechanism that protects a period whose stock has been reported and whose GST
     * has been filed, and this document does not write on its own date: it rewrites the RECEIPT's
     * stored valuation and the layer the receipt opened, both of which sit in the receipt's period.
     * A REVALUATION attempting the same change inside the lock is refused, so without this check
     * LANDED_COST would be the one type that walks through it — simply by being dated after it.
     */
    public function testAReceiptInsideALockedPeriodIsRefused(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $b = $this->makeItem('Dear', $this->pcs, 'FIFO');
        $receipt = $this->receipt($a, $b);
        $lineId = (int) $receipt['lines'][0]['line_id'];
        $this->db->table('inv_period_locks')->insert([
            'cmp_id' => $this->cmpId, 'bo_id' => 0, 'locked_upto_date' => '2026-04-30', 'reason' => 'April reported and GST filed',
        ]);

        $e = $this->refusal(fn () => $this->landedCost((int) $receipt['document_id'], [['cost_type' => 'freight', 'amount' => 400, 'allocation_basis' => 'value']], '2026-05-05'));
        $this->assertInstanceOf(InventoryException::class, $e);
        $this->assertStringContainsString('is dated 2026-04-10', $e->getMessage());
        $this->assertStringContainsString('locked period', $e->getMessage());

        $line = $this->line($lineId);
        $this->assertEqualsWithDelta(1000.0, (float) $line['valuation_amount'], 0.0001, 'the filed period is exactly where it was');
        $this->assertEqualsWithDelta(100.0, (float) $line['valuation_rate'], 0.0001);
        $this->assertEqualsWithDelta(100.0, (float) $this->db->table('inv_cost_layers')->where('source_line_id', $lineId)->get()->getRowArray()['unit_cost'], 0.0001);

        // Released, the same charge posts: the refusal is about the lock and nothing else.
        $this->db->table('inv_period_locks')->where('cmp_id', $this->cmpId)->update(['released_at' => date('Y-m-d H:i:s')]);
        $doc = $this->landedCost((int) $receipt['document_id'], [['cost_type' => 'freight', 'amount' => 400, 'allocation_basis' => 'value']], '2026-05-05');
        $this->assertRevaluationEffect($doc['accounting_effects'], 400.0);
    }

    // ------------------------------------------------------------------ refusals

    private function refusal(callable $fn): \Throwable
    {
        try {
            $fn();
        } catch (\Throwable $e) {
            return $e;
        }
        $this->fail('expected a refusal');
    }

    public function testADraftWithNoTargetOrNoChargeCannotEvenBeSaved(): void
    {
        $noTarget = $this->refusal(fn () => $this->docs->create($this->ctx(), [
            'document_type' => 'LANDED_COST', 'document_date' => '2026-04-18', 'metadata' => ['charges' => [['cost_type' => 'freight', 'amount' => 100]]],
        ], 'tester', 'inventory'));
        $this->assertStringContainsString('must name the receipt it loads', $noTarget->getMessage());

        $noCharge = $this->refusal(fn () => $this->docs->create($this->ctx(), [
            'document_type' => 'LANDED_COST', 'document_date' => '2026-04-18', 'metadata' => ['target_document_id' => 1],
        ], 'tester', 'inventory'));
        $this->assertStringContainsString('at least one charge', $noCharge->getMessage());
    }

    public function testADraftTargetIsRefusedBecauseNoStockHasBeenReceivedYet(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $draft = $this->docs->create($this->ctx(), [
            'document_type' => 'PURCHASE_RECEIPT', 'document_date' => '2026-04-10', 'source_document_type' => 'books.purchase', 'source_document_id' => 910,
            'lines' => [['item_id' => $a, 'warehouse_id' => $this->wh, 'unit_id' => $this->pcs, 'qty' => 10, 'rate' => 100]],
        ], 'tester', 'books');

        $e = $this->refusal(fn () => $this->landedCost((int) $draft['document_id'], [['cost_type' => 'freight', 'amount' => 100]]));
        $this->assertStringContainsString('is DRAFT', $e->getMessage());
        $this->assertStringContainsString('must be posted first', $e->getMessage());
    }

    public function testATargetInAnotherCompanyIsRefused(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $b = $this->makeItem('Dear', $this->pcs, 'FIFO');
        $receipt = $this->receipt($a, $b);
        $this->db->table('inv_documents')->where('document_id', (int) $receipt['document_id'])->update(['cmp_id' => $this->cmpId + 1]);

        $e = $this->refusal(fn () => $this->landedCost((int) $receipt['document_id'], [['cost_type' => 'freight', 'amount' => 100]]));
        $this->assertStringContainsString('belongs to another company', $e->getMessage());
    }

    public function testATargetThatIsNotFoundIsRefused(): void
    {
        $e = $this->refusal(fn () => $this->landedCost(999999, [['cost_type' => 'freight', 'amount' => 100]]));
        $this->assertStringContainsString('was not found', $e->getMessage());
    }

    /** A challan values only the stock it moves, so a challan_only one has no cost of goods to join. */
    public function testATargetThatCarriesNoValuationOnItsLinesIsRefused(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $challan = $this->postDoc([
            'document_type' => 'INWARD_CHALLAN', 'document_date' => '2026-04-10', 'stock_effect' => 'challan_only',
            'lines' => [['item_id' => $a, 'warehouse_id' => $this->wh, 'unit_id' => $this->pcs, 'qty' => 10]],
        ]);

        $e = $this->refusal(fn () => $this->landedCost((int) $challan['document_id'], [['cost_type' => 'freight', 'amount' => 100]]));
        $this->assertStringContainsString('carries no valuation on its lines', $e->getMessage());
    }

    /** An issue is posted and valued, but it has no inward line, so there is nothing to load onto. */
    public function testATargetWithNoValuedInwardLineIsRefused(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $b = $this->makeItem('Dear', $this->pcs, 'FIFO');
        $this->receipt($a, $b);
        $issue = $this->postDoc([
            'document_type' => 'MATERIAL_ISSUE', 'document_date' => '2026-04-12',
            'lines' => [['item_id' => $a, 'warehouse_id' => $this->wh, 'unit_id' => $this->pcs, 'qty' => 2]],
        ]);

        $e = $this->refusal(fn () => $this->landedCost((int) $issue['document_id'], [['cost_type' => 'freight', 'amount' => 100]]));
        $this->assertStringContainsString('no valued inward line', $e->getMessage());
    }

    public function testAManualShareNamingALineOfSomeOtherDocumentIsRefused(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $b = $this->makeItem('Dear', $this->pcs, 'FIFO');
        $receipt = $this->receipt($a, $b);
        $other = $this->receipt($a, $b, 902);

        $e = $this->refusal(fn () => $this->landedCost((int) $receipt['document_id'], [
            ['cost_type' => 'freight', 'amount' => 100, 'allocation_basis' => 'manual', 'lines' => [['line_id' => (int) $other['lines'][0]['line_id'], 'amount' => 100]]],
        ]));
        $this->assertStringContainsString('not a valued inward line of the receipt being loaded', $e->getMessage());
    }

    public function testManualSharesThatDoNotTieToTheChargeAreRefused(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $b = $this->makeItem('Dear', $this->pcs, 'FIFO');
        $receipt = $this->receipt($a, $b);

        $e = $this->refusal(fn () => $this->landedCost((int) $receipt['document_id'], [
            ['cost_type' => 'freight', 'amount' => 100, 'allocation_basis' => 'manual', 'lines' => [['line_id' => (int) $receipt['lines'][0]['line_id'], 'amount' => 40]]],
        ]));
        $this->assertStringContainsString('the per-line shares sum to', $e->getMessage());
    }

    public function testADirectChargeNamingMoreThanOneLineIsRefused(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $b = $this->makeItem('Dear', $this->pcs, 'FIFO');
        $receipt = $this->receipt($a, $b);

        $e = $this->refusal(fn () => $this->landedCost((int) $receipt['document_id'], [
            ['cost_type' => 'non_creditable_tax', 'amount' => 100, 'allocation_basis' => 'direct', 'lines' => [
                ['line_id' => (int) $receipt['lines'][0]['line_id'], 'amount' => 60],
                ['line_id' => (int) $receipt['lines'][1]['line_id'], 'amount' => 40],
            ]],
        ]));
        $this->assertStringContainsString('belongs to exactly one line by nature', $e->getMessage());
    }

    /**
     * Without this refusal the generic reversal would mark the document REVERSED, write no
     * compensating movement, find no valued line of its own to unwind, and leave every layer it
     * raised exactly where it put them — a document that reports it was undone and was not.
     */
    public function testALandedCostAllocationCannotBeReversed(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $b = $this->makeItem('Dear', $this->pcs, 'FIFO');
        $receipt = $this->receipt($a, $b);
        $doc = $this->landedCost((int) $receipt['document_id'], [['cost_type' => 'freight', 'amount' => 400, 'allocation_basis' => 'value']]);

        $e = $this->refusal(fn () => $this->posting->reverse($this->cmpId, (int) $doc['document_id'], 'tester', 'keyed the wrong bill'));

        $this->assertInstanceOf(InventoryException::class, $e);
        $this->assertStringContainsString('cannot be reversed', $e->getMessage());
        $this->assertSame('POSTED', $this->docs->get($this->cmpId, (int) $doc['document_id'])['status'], 'and it stays posted rather than half-undone');
        $layer = $this->db->table('inv_cost_layers')->where('source_line_id', (int) $receipt['lines'][0]['line_id'])->get()->getRowArray();
        $this->assertEqualsWithDelta(110.0, (float) $layer['unit_cost'], 0.0001, 'the uplift is still there, which is why the refusal is honest');
    }

    /**
     * It writes no stock movement and enqueues no recalculation job. The first because it moves no
     * stock; the second because a replay would re-price from the original receipt date and
     * retro-cost everything issued since — turning "not retro-costed" into "retro-costed" with
     * nobody asking.
     */
    public function testItMovesNoStockAndQueuesNoReplay(): void
    {
        $a = $this->makeItem('Cheap', $this->pcs, 'FIFO');
        $b = $this->makeItem('Dear', $this->pcs, 'FIFO');
        $receipt = $this->receipt($a, $b);
        $before = $this->db->table('inv_stock_balances')->selectSum('on_hand_qty', 'q')->get()->getRowArray()['q'];

        $doc = $this->landedCost((int) $receipt['document_id'], [['cost_type' => 'freight', 'amount' => 400, 'allocation_basis' => 'value']]);

        $this->assertSame(0, $this->db->table('inv_stock_movements')->where('document_id', (int) $doc['document_id'])->countAllResults());
        $this->assertEqualsWithDelta((float) $before, (float) $this->db->table('inv_stock_balances')->selectSum('on_hand_qty', 'q')->get()->getRowArray()['q'], 0.0001);
        $this->assertSame(0, $this->db->table('inv_valuation_recalc_jobs')->countAllResults());
    }
}
