<?php

namespace App\Services;

use CodeIgniter\HTTP\RequestInterface;

/**
 * Resolves portal-level company access (acs_type) from the Manage API.
 *
 * Manage returns ownership / is_creator; this normalizes to acs_type (1 = owner, 0 = delegated).
 *
 * BaseController::enrichSessionAccessType() calls this for every session-authenticated request
 * whose session does not already carry acs_type=1 — that is, every browser request from a
 * delegated user, and every request whose portal session payload omits acs_type. A service-key
 * caller never reaches here.
 */
class PortalCompanyAccessService
{
    /** @var array<string, ?int> */
    private static array $cache = [];

    /** @var array<string, bool> */
    private static array $visibilityCache = [];

    private ManageCompanyAccessMapper $accessMapper;

    public function __construct(private ?string $authHeader = null)
    {
        $this->accessMapper = new ManageCompanyAccessMapper();
    }

    public function withAuth(?string $authHeader): self
    {
        $clone = clone $this;
        $clone->authHeader = $authHeader;

        return $clone;
    }

    public function resolveAcsTypeForCompany(int $cmpId, ?RequestInterface $request = null): ?int
    {
        if ($cmpId <= 0 || $this->authHeader === null || $this->authHeader === '') {
            return null;
        }

        $cacheKey = md5($this->authHeader . ':' . $cmpId);
        if (array_key_exists($cacheKey, self::$cache)) {
            return self::$cache[$cacheKey];
        }

        $request ??= service('request');
        $base = rtrim(ManageApiBaseResolver::resolveForRequest($request), '/');

        $fromInfo = $this->fetchAcsType("{$base}/api/companyinfo?comp_id={$cmpId}", $request);
        if ($fromInfo !== null) {
            self::$cache[$cacheKey] = $fromInfo;

            return $fromInfo;
        }

        $fromList = $this->findAcsTypeInCompanyList($base, $cmpId, $request);
        self::$cache[$cacheKey] = $fromList;

        return $fromList;
    }

    public function isPortalOwnerForCompany(int $cmpId, ?RequestInterface $request = null): bool
    {
        return $this->resolveAcsTypeForCompany($cmpId, $request) === 1;
    }

    /**
     * True when the company is listed for this user in Manage — i.e. they own it or it was
     * shared with them. Used when companyinfo omits ownership/access_type and acs_type stays
     * null: the list itself is the access check, so a hit is proof of a share.
     */
    public function companyVisibleToUser(int $cmpId, ?RequestInterface $request = null): bool
    {
        if ($cmpId <= 0 || $this->authHeader === null || $this->authHeader === '') {
            return false;
        }

        $cacheKey = 'visible:' . md5($this->authHeader . ':' . $cmpId);
        if (array_key_exists($cacheKey, self::$visibilityCache)) {
            return self::$visibilityCache[$cacheKey];
        }

        $request ??= service('request');
        $base = rtrim(ManageApiBaseResolver::resolveForRequest($request), '/');
        $visible = $this->findCompanyRowInList($base, $cmpId, $request) !== null;
        self::$visibilityCache[$cacheKey] = $visible;

        return $visible;
    }

    protected function fetchAcsType(string $url, ?RequestInterface $request = null): ?int
    {
        $body = $this->getJson($url, $request);

        return $body === null ? null : $this->extractAcsType($body);
    }

    protected function findAcsTypeInCompanyList(string $base, int $cmpId, ?RequestInterface $request = null): ?int
    {
        $row = $this->findCompanyRowInList($base, $cmpId, $request);

        return $row === null ? null : $this->extractAcsTypeFromRow($row);
    }

    /** @return array<string, mixed>|null */
    protected function findCompanyRowInList(string $base, int $cmpId, ?RequestInterface $request = null): ?array
    {
        for ($page = 1; $page <= 5; $page++) {
            $url = "{$base}/api/companies?filter=all&page={$page}&per_page=100";
            $body = $this->getJson($url, $request);
            if ($body === null) {
                return null;
            }
            $rows = $this->extractCompanyRows($body);
            foreach ($rows as $row) {
                $id = (int) ($row['comp_id'] ?? $row['cmp_id'] ?? $row['id'] ?? 0);
                if ($id === $cmpId) {
                    return $row;
                }
            }
            $total = (int) ($body['total'] ?? $body['meta']['total'] ?? count($rows));
            if ($page * 100 >= $total || $rows === []) {
                break;
            }
        }

        return null;
    }

    /**
     * @param array<string, mixed> $body
     *
     * @return list<array<string, mixed>>
     */
    protected function extractCompanyRows(array $body): array
    {
        $data = $body['data'] ?? null;
        if (is_array($data)) {
            if (isset($data[0]) && is_array($data[0])) {
                return array_values(array_filter($data, 'is_array'));
            }
            foreach (['companies', 'items'] as $key) {
                if (isset($data[$key]) && is_array($data[$key])) {
                    return array_values(array_filter($data[$key], 'is_array'));
                }
            }
            if (array_key_exists('comp_id', $data) || array_key_exists('cmp_id', $data) || array_key_exists('id', $data)) {
                return [$data];
            }
        }
        if (isset($body[0]) && is_array($body[0])) {
            return array_values(array_filter($body, 'is_array'));
        }

        return [];
    }

    /** @param array<string, mixed> $row */
    protected function extractAcsTypeFromRow(array $row): ?int
    {
        return $this->accessMapper->resolveFromRow($row);
    }

    /** @param array<string, mixed> $payload */
    protected function extractAcsType(array $payload): ?int
    {
        $fromRow = $this->extractAcsTypeFromRow($payload);
        if ($fromRow !== null) {
            return $fromRow;
        }
        $data = $payload['data'] ?? null;
        if (is_array($data)) {
            if (isset($data[0]) && is_array($data[0])) {
                return null;
            }
            $fromData = $this->extractAcsTypeFromRow($data);
            if ($fromData !== null) {
                return $fromData;
            }
            if (isset($data['company']) && is_array($data['company'])) {
                return $this->extractAcsTypeFromRow($data['company']);
            }
        }

        return null;
    }

    /** @return array<string, mixed>|null */
    protected function getJson(string $url, ?RequestInterface $request = null): ?array
    {
        $headers = ['Accept' => 'application/json'];
        if ($this->authHeader !== null && $this->authHeader !== '') {
            $headers['Authorization'] = $this->authHeader;
        }
        $request ??= service('request');
        foreach (['X-Origin-Host', 'X-Books-Origin-Host'] as $header) {
            $originHost = trim($request->getHeaderLine($header));
            if ($originHost !== '') {
                $headers[$header] = $originHost;
            }
        }
        try {
            $client   = service('curlrequest', ['http_errors' => false, 'timeout' => 10, 'connect_timeout' => 5]);
            $response = $client->request('GET', $url, ['headers' => $headers]);
            if ($response->getStatusCode() >= 400) {
                return null;
            }
            $body = json_decode((string) $response->getBody(), true);

            return is_array($body) ? $body : null;
        } catch (\Throwable) {
            return null;
        }
    }
}
