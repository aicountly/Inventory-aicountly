<?php

namespace App\Controllers\Api;

use App\Models\Api\AppCommonModel;
use App\Services\AccessService;
use App\Services\AuditService;
use App\Services\PortalCompanyAccessService;
use App\Services\ServiceKeyAuthenticator;
use App\Traits\CompanyContextTrait;
use CodeIgniter\API\ResponseTrait;
use CodeIgniter\RESTful\ResourceController;

/**
 * Base for every Inventory API controller.
 *
 * Two ways in:
 *  1. A human session — `Authorization: Bearer <ses_key>` validated against the
 *     AICOUNTLY portal (my.aicountly.com/api/validatesession), exactly as Books does.
 *  2. A trusted product backend — `X-Service-Key: <key>` (Books, Sales, Purchases,
 *     POS, Billing). The caller must also send `X-Actor-Uuid` (the human behind the
 *     request, recorded in the audit trail) and `X-Source-App`.
 *
 * Every action then requires company context (cmp_id, fy_id, bo_id) and asserts the
 * permission through AccessService. Tenant isolation: the company id in the request is
 * never trusted by itself — the session (or service key) must be allowed on that company.
 */
class BaseController extends ResourceController
{
    use ResponseTrait;
    use CompanyContextTrait;

    protected AppCommonModel $appCommon;
    protected AccessService $access;

    public function __construct()
    {
        $this->appCommon = new AppCommonModel();
        $this->access   = new AccessService();
    }

    /**
     * `source_app` is the owning product of anything this caller writes and is decided here,
     * not by the request: a service key resolves to its product, a human session is always
     * 'inventory'. `client_app` keeps the X-Source-App label for telemetry only.
     *
     * @return array{uuid:string, ses_key?:string, acs_type?:int|null, kind:string, source_app:string, client_app?:string}|null
     */
    protected function auth(): ?array
    {
        $serviceKey = trim($this->request->getHeaderLine('X-Service-Key'));
        if ($serviceKey !== '') {
            $app = (new ServiceKeyAuthenticator())->resolveApp($serviceKey);
            if ($app === null) {
                return null;
            }
            $actor = trim($this->request->getHeaderLine('X-Actor-Uuid'));

            return [
                'uuid'       => $actor !== '' ? $actor : 'service:' . $app,
                'acs_type'   => null,
                'kind'       => 'service',
                'source_app' => $app,
            ];
        }

        $authHeader = $this->request->getHeaderLine('Authorization')
            ?: ($_SERVER['HTTP_AUTHORIZATION'] ?? '')
            ?: ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
        if (!$authHeader || !preg_match('/Bearer\s+(.+)/i', $authHeader, $m)) {
            return null;
        }
        $sesKey = trim($m[1]);
        $ses = $this->appCommon->validateSesKey($sesKey);
        if (!$ses || ($ses['status'] ?? 0) !== 1) {
            return null;
        }
        // A human session is always Inventory's own, whichever SPA the browser came from.
        // X-Source-App is a client-controlled header, so it may label the caller for telemetry
        // but must never decide which product owns a row it writes — only a service key,
        // resolved above, can claim to be Books / Sales / POS.
        return [
            'uuid'       => $ses['uuid_aictly'] ?? ($ses['uuid'] ?? ''),
            'ses_key'    => $sesKey,
            'acs_type'   => isset($ses['acs_type']) ? (int) $ses['acs_type'] : null,
            'kind'       => 'user',
            'source_app' => 'inventory',
            'client_app' => strtolower(trim($this->request->getHeaderLine('X-Source-App'))) ?: 'inventory',
        ];
    }

    /**
     * The owning product for a row this request is about to write.
     *
     * Never the caller's word for it: a trusted service key resolves to the calling product,
     * every human session is Inventory's own. A body that claims a different app is a caller
     * trying to mint another product's document — answered with 403, not silently honoured.
     *
     * @param array<string, mixed> $session
     * @param array<string, mixed> $body
     * @return array{app?:string, response?:mixed}
     */
    protected function resolveSourceApp(array $session, array $body, ?string $expected = null): array
    {
        $app = $expected ?? (($session['kind'] ?? '') === 'service' ? strtolower((string) ($session['source_app'] ?? '')) : 'inventory');
        if ($app === '') {
            $app = 'inventory';
        }
        $claimed = strtolower(trim((string) ($body['source_app'] ?? '')));
        if ($claimed !== '' && $claimed !== $app) {
            return ['response' => $this->failStructured(403, 'forbidden', 'source_app must be the authenticated caller (' . $app . '), not "' . $claimed . '"')];
        }

        return ['app' => $app];
    }

    protected function enrichSessionAccessType(array $session, ?array $ctx): array
    {
        if (($session['kind'] ?? '') === 'service') {
            return $session;
        }
        if ((int) ($session['acs_type'] ?? 0) === 1) {
            return $session;
        }
        if ($ctx !== null && isset($ctx['acs_type']) && (int) $ctx['acs_type'] === 1) {
            $session['acs_type'] = 1;

            return $session;
        }
        if ($ctx === null || empty($ctx['cmp_id'])) {
            return $session;
        }
        $auth = $this->request->getHeaderLine('Authorization');
        if ($auth === '') {
            return $session;
        }
        // Enrichment only ever upgrades acs_type; AccessService::assert() still decides. So a
        // failure here must leave the session as it was, never abort the request: this call
        // reaches out to Manage over the network, and for a while the class it needs was
        // missing entirely, which turned every delegated user's request into a blank 500.
        try {
            $resolved = (new PortalCompanyAccessService())
                ->withAuth($auth)
                ->resolveAcsTypeForCompany((int) $ctx['cmp_id'], $this->request);
            if ($resolved !== null) {
                $session['acs_type'] = $resolved;
            }
        } catch (\Throwable $e) {
            log_message('error', 'Portal access-type lookup failed for company {cmp}: {msg}', [
                'cmp' => (int) $ctx['cmp_id'],
                'msg' => $e->getMessage(),
            ]);
        }

        return $session;
    }

    /**
     * auth + company context + permission in one call.
     *
     * @return array{session?:array, ctx?:array, response?:mixed}
     */
    protected function authorize(?string $permission, bool $requireContext = true, bool $requireFy = true): array
    {
        $session = $this->auth();
        if (!$session) {
            return ['response' => $this->failUnauthorized('Invalid or expired session')];
        }

        $ctx = null;
        if ($requireContext) {
            $ctx = $this->requireCompanyContext($requireFy);
            if (!$ctx) {
                return ['response' => $this->failStructured(400, 'context_required', 'Company context required (cmp_id, fy_id, bo_id)')];
            }
        }

        if ($ctx !== null) {
            $session = $this->enrichSessionAccessType($session, $ctx);
        }

        if ($permission !== null && $ctx !== null) {
            try {
                $this->access->assert($session['uuid'], $ctx, $permission, $session);
            } catch (\RuntimeException $e) {
                $code = $e->getCode() >= 400 ? $e->getCode() : 403;
                if ($code === 403) {
                    $this->logAccessDenied($session['uuid'] ?? null, (int) ($ctx['cmp_id'] ?? 0), $permission, $e->getMessage());
                }

                return ['response' => $this->failStructured($code, $code === 403 ? 'forbidden' : 'error', $e->getMessage())];
            }
        }

        return ['session' => $session, 'ctx' => $ctx];
    }

    /** @param list<string> $permissions */
    protected function authorizeAny(array $permissions, bool $requireContext = true, bool $requireFy = true): array
    {
        $last = null;
        foreach ($permissions as $permission) {
            $a = $this->authorize($permission, $requireContext, $requireFy);
            if (!isset($a['response'])) {
                return $a;
            }
            $last = $a;
        }

        return $last ?? ['response' => $this->failForbidden('Forbidden')];
    }

    /**
     * Structured error envelope: {error: {code, message, details?}}.
     *
     * @param array<string, mixed>|null $details
     */
    protected function failStructured(int $status, string $code, string $message, ?array $details = null)
    {
        $body = ['error' => ['code' => $code, 'message' => $message]];
        if ($details !== null) {
            $body['error']['details'] = $details;
        }
        // Keep the legacy top-level "message" so existing AICOUNTLY clients keep working.
        $body['message'] = $message;

        return $this->respond($body, $status);
    }

    /**
     * Map a domain exception to a response. RuntimeException codes 4xx are client errors;
     * DomainException carries a structured code in its message when thrown by services.
     */
    protected function failFromException(\Throwable $e)
    {
        $code = (int) $e->getCode();
        if ($e instanceof \App\Exceptions\InventoryException) {
            return $this->failStructured($e->httpStatus(), $e->errorCode(), $e->getMessage(), $e->details());
        }
        if ($code >= 400 && $code < 600) {
            return $this->failStructured($code, $code === 404 ? 'not_found' : ($code === 409 ? 'conflict' : ($code === 422 ? 'validation_failed' : 'error')), $e->getMessage());
        }
        log_message('error', 'Inventory API error: {msg} {trace}', ['msg' => $e->getMessage(), 'trace' => $e->getTraceAsString()]);

        return $this->failStructured(500, 'internal_error', 'Unexpected error: ' . $e->getMessage());
    }

    /**
     * Standard list envelope with pagination.
     *
     * @param list<array<string, mixed>> $rows
     */
    protected function respondList(array $rows, int $total, int $limit, int $offset, array $extra = [])
    {
        return $this->respond(array_merge([
            'data' => $rows,
            'meta' => [
                'total'  => $total,
                'limit'  => $limit,
                'offset' => $offset,
            ],
        ], $extra));
    }

    /** @return array{limit:int, offset:int, sort:string, order:string} */
    protected function listParams(int $defaultLimit = 50, int $maxLimit = 500, string $defaultSort = ''): array
    {
        $limit = (int) ($this->request->getGet('limit') ?? $this->request->getGet('per_page') ?? $defaultLimit);
        $limit = max(1, min($maxLimit, $limit));
        $page = (int) ($this->request->getGet('page') ?? 0);
        $offset = (int) ($this->request->getGet('offset') ?? 0);
        if ($page > 0 && $offset === 0) {
            $offset = ($page - 1) * $limit;
        }
        $sort = trim((string) ($this->request->getGet('sort') ?? $defaultSort));
        $order = strtolower(trim((string) ($this->request->getGet('order') ?? 'asc'))) === 'desc' ? 'DESC' : 'ASC';

        return ['limit' => $limit, 'offset' => max(0, $offset), 'sort' => $sort, 'order' => $order];
    }

    protected function idempotencyKey(): ?string
    {
        $key = trim($this->request->getHeaderLine('Idempotency-Key'));
        if ($key === '') {
            $json = $this->parseOptionalRequestJson();
            $key = trim((string) ($json['idempotency_key'] ?? ''));
        }

        return $key !== '' ? substr($key, 0, 128) : null;
    }

    protected function logAccessDenied(?string $actorUuid, int $cmpId, string $permission, string $message): void
    {
        try {
            (new AuditService())->log($cmpId > 0 ? $cmpId : 0, 'access', 0, 'access.denied', $actorUuid, [
                'permission' => $permission,
                'message'    => $message,
            ]);
        } catch (\Throwable) {
            // best-effort
        }
    }
}
