<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * The 500 that stopped a live company granting Inventory access on 2026-09-15.
 *
 * AccessController::provisionMember() built its status like this:
 *
 *     'status' => in_array($body['status'] ?? 'active', ['active','invited','revoked'], true)
 *         ? $body['status'] : 'active'
 *
 * The CONDITION coalesces a missing key to 'active' and therefore passes; the TRUE BRANCH then
 * reads $body['status'] with no coalesce at all. A caller that omits status — which is every call
 * the access UI makes — trips "Undefined array key". Locally that is a warning nobody sees. With
 * CI_ENVIRONMENT=production CodeIgniter promotes it to an exception, so the endpoint answered 500
 * and no member could be added for ANY company.
 *
 * These tests pin the resolution rule itself rather than the controller, because the controller
 * needs a booted HTTP stack and this defect lives entirely in one expression. The shape under test
 * is copied from the controller; AccessMemberProvisionIntegrationTest drives the real endpoint.
 */
final class AccessMemberProvisionStatusTest extends TestCase
{
    /** The fixed rule, matching AccessController::provisionMember(). */
    private function resolveStatus(array $body): string
    {
        $status = (string) ($body['status'] ?? 'active');

        return in_array($status, ['active', 'invited', 'revoked'], true) ? $status : 'active';
    }

    public function testABodyWithNoStatusKeyDoesNotTouchAMissingKey(): void
    {
        // The exact production payload shape: the UI sends uuid and a profile, never a status.
        $body = ['uuid' => '7', 'profile_id' => 10];

        $before = error_reporting();
        error_reporting(E_ALL);
        set_error_handler(static function (int $no, string $msg): bool {
            throw new \ErrorException($msg, 0, $no);
        });

        try {
            $status = $this->resolveStatus($body);
        } finally {
            restore_error_handler();
            error_reporting($before);
        }

        $this->assertSame('active', $status);
    }

    public function testTheThreeAcceptedStatusesSurvive(): void
    {
        foreach (['active', 'invited', 'revoked'] as $status) {
            $this->assertSame($status, $this->resolveStatus(['status' => $status]));
        }
    }

    public function testAnythingElseFallsBackToActiveRatherThanReachingTheDatabase(): void
    {
        // inv_company_members.status is VARCHAR(16) with no CHECK, so an unvetted value would be
        // stored verbatim and every later whereIn('status', [...]) would silently skip the row.
        foreach (['deleted', 'ACTIVE', '', 'active; drop table', 'suspended'] as $status) {
            $this->assertSame('active', $this->resolveStatus(['status' => $status]));
        }
    }

    public function testANonStringStatusIsCoercedBeforeComparisonRatherThanFatalling(): void
    {
        $this->assertSame('active', $this->resolveStatus(['status' => null]));
        $this->assertSame('active', $this->resolveStatus(['status' => 0]));
    }

    public function testTheControllerUsesTheResolvedVariableAndNotTheRawBodyKey(): void
    {
        // Guards the specific regression: if someone reintroduces $body['status'] in the row
        // assignment, the asymmetry comes straight back and production 500s again.
        $source = (string) file_get_contents(
            (string) (new \ReflectionClass(\App\Controllers\Api\V1\AccessController::class))->getFileName()
        );
        $this->assertStringContainsString("'status' => \$status,", $source);
        // Target the ASSIGNMENT, not the prose: the docblock above the fix quotes the old
        // expression on purpose, and a guard that cannot tell code from a comment would fail on
        // the very explanation of what it guards.
        $this->assertStringNotContainsString("'status' => in_array(", $source);
    }
}
