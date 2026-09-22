<?php

namespace Tests\Integration;

use App\Services\OpeningValueSyncService;
use Tests\Support\IntegrationTestCase;

/**
 * syncIfChanged() is the one thing standing between "Inventory has a real opening" and "Books
 * gets told about it": it must fire exactly once per genuine change, carry the same figure
 * ReconciliationService::inventoryOpeningValue() already computes (so Books never receives a
 * different number than reconciliation compares itself against), and never spam an event for a
 * value that has not actually moved -- a company entering ten items' openings one at a time must
 * not rewrite Books' OB-M journal ten times.
 *
 * @group integration
 */
final class OpeningValueSyncServiceTest extends IntegrationTestCase
{
    private function events(): array
    {
        return $this->db->table('inv_integration_events')
            ->where('cmp_id', $this->cmpId)
            ->where('event_type', OpeningValueSyncService::EVENT)
            ->orderBy('event_id', 'ASC')
            ->get()->getResultArray();
    }

    public function testEnqueuesOneEventCarryingTheSameValueReconciliationWouldCompute(): void
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Widget', $pcs);
        $this->setOpening($item, $pcs, 10, 100); // 1,000

        (new OpeningValueSyncService())->syncIfChanged($this->cmpId, $this->fyId);

        $events = $this->events();
        $this->assertCount(1, $events);
        $payload = json_decode((string) $events[0]['payload_json'], true);
        $this->assertSame($this->cmpId, (int) $payload['cmp_id']);
        $this->assertSame($this->fyId, (int) $payload['fy_id']);
        $this->assertSame(0, (int) $payload['bo_id']);
        $this->assertEqualsWithDelta(1000.0, (float) $payload['opening_value'], 0.0001);
        $this->assertSame('books', $events[0]['target_app']);
    }

    public function testDoesNotReEnqueueWhenTheValueHasNotChanged(): void
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Widget', $pcs);
        $this->setOpening($item, $pcs, 10, 100);

        $svc = new OpeningValueSyncService();
        $svc->syncIfChanged($this->cmpId, $this->fyId);
        $svc->syncIfChanged($this->cmpId, $this->fyId);
        $svc->syncIfChanged($this->cmpId, $this->fyId);

        $this->assertCount(1, $this->events(), 'three calls with an unchanged value must enqueue exactly once');
    }

    public function testEnqueuesAgainOnceTheResolvedValueActuallyMoves(): void
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Widget', $pcs);
        $this->setOpening($item, $pcs, 10, 100); // 1,000

        $svc = new OpeningValueSyncService();
        $svc->syncIfChanged($this->cmpId, $this->fyId);

        // A second item's opening is entered -- the company's resolved total genuinely changes.
        $item2 = $this->makeItem('Gadget', $pcs);
        $this->setOpening($item2, $pcs, 5, 50); // +250

        $svc->syncIfChanged($this->cmpId, $this->fyId);

        $events = $this->events();
        $this->assertCount(2, $events);
        $second = json_decode((string) $events[1]['payload_json'], true);
        $this->assertEqualsWithDelta(1250.0, (float) $second['opening_value'], 0.0001);
    }

    public function testWatermarkPersistsTheLastPushedValue(): void
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Widget', $pcs);
        $this->setOpening($item, $pcs, 10, 100);

        (new OpeningValueSyncService())->syncIfChanged($this->cmpId, $this->fyId);

        $state = $this->db->table('inv_opening_sync_state')
            ->where('cmp_id', $this->cmpId)->where('fy_id', $this->fyId)->where('bo_id', 0)
            ->get()->getRowArray();
        $this->assertNotNull($state);
        $this->assertEqualsWithDelta(1000.0, (float) $state['last_pushed_value'], 0.0001);
    }

    /**
     * Most companies have no opening stock at all — a production --all run found 17 of 21 at
     * zero. Books' own guard refuses a zero when there is no row to delete, so each of those
     * events is pure outbox noise; at 1 lakh companies an --all run would queue ~1 lakh no-ops
     * through a dispatcher that drains 300 a minute, holding real events behind them for hours.
     */
    public function testNeverEnqueuesAZeroForACompanyThatHasNeverBeenPushed(): void
    {
        $pcs = $this->makeUnit();
        $this->makeItem('Widget', $pcs); // an item, but no opening at all

        (new OpeningValueSyncService())->syncIfChanged($this->cmpId, $this->fyId);

        $this->assertCount(0, $this->events());
        $this->assertNull(
            $this->db->table('inv_opening_sync_state')->where('cmp_id', $this->cmpId)->get()->getRowArray(),
            'a company with nothing to say should not leave a watermark either',
        );
    }

    /** A zero AFTER a real push is meaningful: it tells Books to drop the row this sync wrote. */
    public function testStillEnqueuesAZeroThatFollowsARealPush(): void
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Widget', $pcs);
        $this->setOpening($item, $pcs, 10, 100);

        $svc = new OpeningValueSyncService();
        $svc->syncIfChanged($this->cmpId, $this->fyId);

        // The opening is withdrawn in Inventory; the resolved total drops back to zero.
        $this->db->table('inv_item_openings')->where('cmp_id', $this->cmpId)->delete();
        $svc->syncIfChanged($this->cmpId, $this->fyId);

        $events = $this->events();
        $this->assertCount(2, $events);
        $second = json_decode((string) $events[1]['payload_json'], true);
        $this->assertEqualsWithDelta(0.0, (float) $second['opening_value'], 0.0001);
    }

    public function testSilentlyDoesNothingForAnInvalidCompanyOrFy(): void
    {
        $svc = new OpeningValueSyncService();
        $svc->syncIfChanged(0, $this->fyId);
        $svc->syncIfChanged($this->cmpId, 0);

        $this->assertCount(0, $this->events());
    }
}
