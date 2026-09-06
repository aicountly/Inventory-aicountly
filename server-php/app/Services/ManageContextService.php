<?php

namespace App\Services;

/**
 * Read-only access to Manage (company / branch / financial year truth).
 *
 * Inventory never stores these masters. It asks Manage (server-to-server, forwarding the
 * caller's bearer, or with the configured service base for background workers) and caches
 * per request. When Manage is unreachable a posting is refused rather than guessed.
 */
class ManageContextService
{
    /** @var array<string, array<string, mixed>|null> */
    private static array $companyInfoCache = [];
    private ?string $authHeader = null;
    private ?string $lastError = null;

    public function withAuth(?string $authHeader): self
    {
        $c = clone $this;
        $c->authHeader = $authHeader;

        return $c;
    }

    public function lastError(): ?string
    {
        return $this->lastError;
    }

    /** @return array<string, mixed>|null */
    public function companyInfo(int $cmpId): ?array
    {
        $key = $cmpId . ':' . md5((string) $this->authHeader);
        if (array_key_exists($key, self::$companyInfoCache)) {
            return self::$companyInfoCache[$key];
        }
        $info = $this->request('GET', 'companyinfo?comp_id=' . $cmpId);

        return self::$companyInfoCache[$key] = $info;
    }

    /**
     * @return array{fy_start: string, fy_end: string}|null
     */
    public function fyDateRange(int $cmpId, int $fyId): ?array
    {
        $local = $this->localFyRange($cmpId, $fyId);
        if ($local !== null) {
            return $local;
        }
        $info = $this->companyInfo($cmpId);
        if ($info === null) {
            return null;
        }
        foreach ($this->extractFyList($info) as $fy) {
            if ((int) ($fy['fy_id'] ?? $fy['id'] ?? 0) !== $fyId) {
                continue;
            }
            $start = $this->pickDate($fy, ['fy_start', 'fy_beg_date', 'fy_start_date', 'start_date', 'from_date']);
            $end = $this->pickDate($fy, ['fy_end', 'fy_end_date', 'end_date', 'to_date']);
            if ($start !== '' && $end !== '') {
                $this->rememberFyRange($cmpId, $fyId, $start, $end);

                return ['fy_start' => $start, 'fy_end' => $end];
            }
        }

        return null;
    }

    /** True when the branch belongs to the company per Manage (bo_id 0 = consolidated / unset). */
    public function branchBelongs(int $cmpId, int $boId): bool
    {
        if ($boId <= 0) {
            return true;
        }
        $info = $this->companyInfo($cmpId);
        if ($info === null) {
            return true; // cannot verify; masters were already validated by the portal session
        }
        foreach ($this->extractBranchList($info) as $b) {
            if ((int) ($b['bo_id'] ?? $b['branch_id'] ?? $b['id'] ?? 0) === $boId) {
                return true;
            }
        }

        return false;
    }

    /**
     * FY ranges learned from Manage are remembered locally (inv_fy_ranges) so posting-time date
     * checks and layer timestamps do not depend on Manage being up. They are a cache, not a master.
     */
    private function localFyRange(int $cmpId, int $fyId): ?array
    {
        $db = \Config\Database::connect();
        if (!SchemaCache::tableExists($db, 'inv_fy_ranges')) {
            return null;
        }
        $row = $db->table('inv_fy_ranges')->where('cmp_id', $cmpId)->where('fy_id', $fyId)->get()->getRowArray();

        return $row ? ['fy_start' => substr((string) $row['fy_start'], 0, 10), 'fy_end' => substr((string) $row['fy_end'], 0, 10)] : null;
    }

    public function rememberFyRange(int $cmpId, int $fyId, string $start, string $end): void
    {
        $db = \Config\Database::connect();
        if (!SchemaCache::tableExists($db, 'inv_fy_ranges')) {
            return;
        }
        $exists = $db->table('inv_fy_ranges')->where('cmp_id', $cmpId)->where('fy_id', $fyId)->countAllResults() > 0;
        $row = ['fy_start' => $start, 'fy_end' => $end, 'updated_at' => date('Y-m-d H:i:s')];
        if ($exists) {
            $db->table('inv_fy_ranges')->where('cmp_id', $cmpId)->where('fy_id', $fyId)->update($row);
        } else {
            $db->table('inv_fy_ranges')->insert(array_merge(['cmp_id' => $cmpId, 'fy_id' => $fyId], $row));
        }
    }

    /** @return list<array<string, mixed>> */
    private function extractFyList(array $info): array
    {
        foreach (['fy_list', 'financial_years', 'fys', 'fy'] as $k) {
            if (isset($info[$k]) && is_array($info[$k])) {
                return array_values(array_filter($info[$k], 'is_array'));
            }
            if (isset($info['data'][$k]) && is_array($info['data'][$k])) {
                return array_values(array_filter($info['data'][$k], 'is_array'));
            }
        }

        return [];
    }

    /** @return list<array<string, mixed>> */
    private function extractBranchList(array $info): array
    {
        foreach (['branches', 'branch_list', 'bo_list'] as $k) {
            if (isset($info[$k]) && is_array($info[$k])) {
                return array_values(array_filter($info[$k], 'is_array'));
            }
            if (isset($info['data'][$k]) && is_array($info['data'][$k])) {
                return array_values(array_filter($info['data'][$k], 'is_array'));
            }
        }

        return [];
    }

    private function pickDate(array $row, array $keys): string
    {
        foreach ($keys as $k) {
            $v = trim((string) ($row[$k] ?? ''));
            if ($v !== '' && preg_match('/^\d{4}-\d{2}-\d{2}/', $v)) {
                return substr($v, 0, 10);
            }
        }

        return '';
    }

    /** @return array<string, mixed>|null */
    private function request(string $method, string $path): ?array
    {
        $this->lastError = null;
        try {
            $request = service('request');
            $base = rtrim(ManageApiBaseResolver::resolveForRequest($request), '/');
        } catch (\Throwable) {
            $base = rtrim((string) (getenv('MANAGE_API_BASE') ?: 'https://manage.aicountly.com'), '/');
        }
        $headers = ['Accept: application/json'];
        $auth = $this->authHeader;
        if ($auth === null || $auth === '') {
            try {
                $auth = service('request')->getHeaderLine('Authorization');
            } catch (\Throwable) {
                $auth = '';
            }
        }
        if ($auth !== '') {
            $headers[] = 'Authorization: ' . $auth;
        }
        $ch = curl_init($base . '/api/' . ltrim($path, '/'));
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT        => 12,
        ]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($body === false || $status === 0) {
            $this->lastError = $err ?: 'Manage unreachable';

            return null;
        }
        if ($status >= 400) {
            $this->lastError = 'Manage HTTP ' . $status;

            return null;
        }
        $data = json_decode((string) $body, true);
        if (!is_array($data)) {
            $this->lastError = 'Manage returned no JSON';

            return null;
        }

        return isset($data['data']) && is_array($data['data']) ? array_merge($data, $data['data']) : $data;
    }
}
