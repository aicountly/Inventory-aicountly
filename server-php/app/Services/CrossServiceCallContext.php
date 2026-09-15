<?php

namespace App\Services;

use CodeIgniter\HTTP\RequestInterface;

/**
 * Which SaaS is waiting on this Inventory request, and therefore which SaaS Inventory must
 * not call back while serving it.
 *
 * WHY THIS EXISTS — PHP-FPM CROSS-POOL STARVATION, NOT RECURSION
 * --------------------------------------------------------------
 * Books and Inventory run in separate PHP-FPM pools, each with a small pm.max_children. A
 * synchronous A -> B call parks an A worker for the whole round trip. If B then calls A on
 * the same request path, a second A worker is parked waiting on B, which is waiting on A:
 *
 *     Inventory worker --HTTP--> Books worker --HTTP--> Inventory worker
 *           (blocked)                (blocked)               (blocked)
 *
 * Nothing recurses in the application sense — each process makes one call and then blocks —
 * so no depth counter or re-entrancy flag inside a single process can see it. What runs out
 * is WORKERS, in both pools at once, and the queue answers 504.
 *
 * THE CHAIN THIS BREAKS
 * ---------------------
 * This was live in production alongside the Manage <-> Books one:
 *
 *   1. Inventory write -> OutboxService::settleOnContact()
 *   2. -> POST books /api/integration/inventory/events        [Books worker blocked]
 *   3. -> InventoryEventHandler::handle() -> acknowledgeRevisions()
 *   4. -> POST inventory /api/v1/valuation/revisions/ack      [Inventory worker blocked]
 *   5. -> BaseController::authorize() -> settleOutboxOnContact()
 *   6. -> POST books /api/integration/inventory/events        [back to step 2]
 *
 * It is broken in two places now: Inventory does not drain its outbox on a Books-originated
 * request (step 5), and Books returns the acknowledgement in its response body instead of
 * calling Inventory back for it (step 4).
 *
 * WHY TRUSTING A CLIENT HEADER IS SAFE
 * ------------------------------------
 * The header can only ever SUPPRESS an outbound call. It grants nothing and bypasses no
 * check; the worst a forged `X-Saas-Origin: books` achieves is that the forger's own request
 * does not drain the outbox, which the next contact or the CLI sweep does instead. Unknown
 * values are ignored. On top of that, {@see adoptAuthenticatedOrigin()} lets the request's
 * *authenticated* product (resolved from the service key, never a header) override it.
 */
final class CrossServiceCallContext
{
    /** Set by the calling SaaS to name itself. */
    public const HEADER = 'X-Saas-Origin';

    /** SaaS names Inventory recognises as callers. Anything else behaves as no header at all. */
    public const KNOWN_SERVICES = ['books', 'manage', 'sales', 'purchases', 'pos', 'auditor', 'my'];

    private static ?string $origin = null;

    private static bool $resolved = false;

    /** The SaaS waiting on this request, or null for a normal (browser) request. */
    public static function origin(?RequestInterface $request = null): ?string
    {
        if (self::$resolved) {
            return self::$origin;
        }

        self::$resolved = true;
        self::$origin = null;

        try {
            $request ??= service('request');
            $raw = strtolower(trim($request->getHeaderLine(self::HEADER)));
        } catch (\Throwable) {
            return self::$origin;
        }

        if ($raw !== '' && in_array($raw, self::KNOWN_SERVICES, true)) {
            self::$origin = $raw;
        }

        return self::$origin;
    }

    /**
     * Record the caller's AUTHENTICATED product for this request.
     *
     * BaseController::auth() resolves source_app from the X-Service-Key, not from a header,
     * so this is the non-forgeable signal. It only ever narrows what Inventory will do.
     */
    public static function adoptAuthenticatedOrigin(?string $app): void
    {
        $app = strtolower(trim((string) $app));
        if ($app === '' || $app === 'inventory' || !in_array($app, self::KNOWN_SERVICES, true)) {
            return;
        }

        self::$origin = $app;
        self::$resolved = true;
    }

    /**
     * May Inventory make a synchronous call to $service while serving this request?
     *
     * False exactly when $service is the SaaS already blocked waiting on us.
     */
    public static function mayCall(string $service, ?RequestInterface $request = null): bool
    {
        return self::origin($request) !== strtolower(trim($service));
    }

    /** True when this request was issued by $service. */
    public static function isInboundFrom(string $service, ?RequestInterface $request = null): bool
    {
        return !self::mayCall($service, $request);
    }

    /**
     * One bounded line per internal service call worth an operator's attention.
     *
     * Logs service, operation (URL PATH only), HTTP status and elapsed milliseconds — never
     * the query string, never headers (they carry the service key), never a response body.
     * Fast successful calls are silent so failures are not buried.
     */
    public static function logCall(string $service, string $url, int $status, float $startedAt, string $error = ''): void
    {
        $elapsedMs = (int) round((microtime(true) - $startedAt) * 1000);
        if ($status >= 200 && $status < 400 && $elapsedMs < 1000) {
            return;
        }
        $path = parse_url($url, PHP_URL_PATH);
        log_message(
            $status >= 200 && $status < 400 ? 'warning' : 'error',
            'internal-call service=' . $service
            . ' op=' . (is_string($path) && $path !== '' ? $path : '(unparseable)')
            . ' status=' . $status
            . ' ms=' . $elapsedMs
            . ($error !== '' ? ' error=' . substr($error, 0, 200) : ''),
        );
    }

    /** Test seam only — request-scoped state must not leak between test cases. */
    public static function reset(?string $origin = null): void
    {
        self::$origin = $origin;
        self::$resolved = $origin !== null;
    }
}
