<?php

namespace Tests\Integration;

use App\Services\OutboxService;
use App\Services\ReconciliationHealService;
use Tests\Support\IntegrationTestCase;

/**
 * "Fix what's safe" is only worth having if "safe" means something. Everything it does is
 * DELIVERY — Inventory already holds the right answer and Books has not been told — so it changes
 * no figure on either side and is idempotent. The tests that matter most here are the ones
 * pinning what it must never touch, because each exclusion is a decision someone could
 * reasonably undo without knowing why it was made.
 *
 * @group integration
 */
final class ReconciliationHealServiceTest extends IntegrationTestCase
{
    private function heal(bool $dryRun = true): array
    {
        return (new ReconciliationHealService())->heal($this->cmpId, $this->fyId, $this->boId, $dryRun, 'user:asha');
    }

    /**
     * Acknowledging a valuation revision means "Books applied this to COGS", and BOOKS writes it.
     * Inventory acking its own would mark an unapplied revision applied and hide a real
     * difference. Retrying a failed posting is blocked on the idempotency-key rollback path,
     * where a retry can double-issue stock.
     */
    public function testTheSafeListIsDeliveryOnly(): void
    {
        $this->assertSame(['opening_difference', 'pending_posting'], ReconciliationHealService::SAFE_BUCKETS);
        $this->assertArrayNotHasKey('opening_difference', ReconciliationHealService::NEVER_TOUCHED);
        foreach (['manual_journal', 'missing_source', 'valuation_method_variance', 'unacknowledged_valuation_revisions', 'failed_posting'] as $bucket) {
            $this->assertArrayHasKey($bucket, ReconciliationHealService::NEVER_TOUCHED, $bucket . ' must stay out of reach');
            $this->assertNotContains($bucket, ReconciliationHealService::SAFE_BUCKETS);
        }
    }

    public function testADryRunReportsThePlanWithoutDoingAnyOfIt(): void
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Widget', $pcs);
        $this->setOpening($item, $pcs, 10, 100);
        (new OutboxService())->enqueue($this->cmpId, 'inventory.document.posted', 'document', 1, null, ['x' => 1]);

        $result = $this->heal(true);

        $this->assertTrue($result['dry_run']);
        $actions = array_column($result['actions'], 'action');
        $this->assertContains('deliver_outbox', $actions);
        foreach ($result['actions'] as $action) {
            $this->assertFalse($action['performed'], 'a dry run must perform nothing');
            $this->assertNull($action['result']);
        }

        // The event is untouched: still waiting, still never attempted.
        $row = $this->db->table('inv_integration_events')->where('cmp_id', $this->cmpId)->get()->getRowArray();
        $this->assertSame('PENDING', $row['status']);
        $this->assertSame(0, (int) $row['attempts']);
    }

    public function testItOnlyEverProposesActionsFromItsOwnSafeList(): void
    {
        $pcs = $this->makeUnit();
        $item = $this->makeItem('Widget', $pcs);
        $this->setOpening($item, $pcs, 10, 100);
        (new OutboxService())->enqueue($this->cmpId, 'inventory.document.posted', 'document', 1, null, ['x' => 1]);

        foreach ($this->heal(true)['actions'] as $action) {
            $this->assertContains($action['bucket'], ReconciliationHealService::SAFE_BUCKETS, $action['bucket'] . ' is not a bucket this may act on');
        }
    }

    /** Nothing waiting and nothing differing: the honest answer is an empty plan, not a no-op run. */
    public function testProposesNothingForACompanyWithNothingToDeliver(): void
    {
        $pcs = $this->makeUnit();
        $this->makeItem('Widget', $pcs);

        $result = $this->heal(true);

        $this->assertSame([], $result['actions']);
    }
}
