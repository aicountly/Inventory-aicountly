<?php

namespace App\Traits;

use App\Services\ManageCompanyAccessMapper;

/**
 * Company / financial-year / branch context for every Inventory API call.
 *
 * Inventory never owns a company, branch or financial year: those masters live in
 * Manage. Callers supply the authoritative ids (cmp_id, fy_id, bo_id) and the
 * BaseController validates the caller's access to that company before any query runs.
 */
trait CompanyContextTrait
{
    /** @return array<string, mixed> */
    protected function parseOptionalRequestJson(): array
    {
        $raw = $this->request->getBody();
        if ($raw === null) {
            return [];
        }
        $trimmed = trim((string) $raw);
        if ($trimmed === '' || ($trimmed[0] !== '{' && $trimmed[0] !== '[')) {
            return [];
        }
        try {
            $json = $this->request->getJSON(true);

            return is_array($json) ? $json : [];
        } catch (\Throwable) {
            return [];
        }
    }

    /**
     * @return array{cmp_id:int, fy_id:int, bo_id:int, acs_type?:int}|null
     */
    protected function requireCompanyContext(bool $requireFy = true): ?array
    {
        $json = $this->parseOptionalRequestJson();
        $get = static fn (string $k) => null;

        $cmpId = $this->request->getGet('cmp_id') ?? $this->request->getPost('cmp_id') ?? ($json['cmp_id'] ?? null);
        $fyId = $this->request->getGet('fy_id') ?? $this->request->getPost('fy_id') ?? ($json['fy_id'] ?? null);
        $boId = $this->request->getGet('bo_id') ?? $this->request->getPost('bo_id') ?? ($json['bo_id'] ?? '0');
        $acsType = $this->request->getHeaderLine('X-Company-Acs-Type')
            ?: ($this->request->getGet('acs_type') ?? $this->request->getPost('acs_type') ?? ($json['acs_type'] ?? null));
        $ownership = $this->request->getHeaderLine('X-Company-Ownership')
            ?: ($this->request->getGet('ownership') ?? $this->request->getPost('ownership') ?? ($json['ownership'] ?? null));
        $isCreator = $this->request->getHeaderLine('X-Company-Is-Creator')
            ?: ($this->request->getGet('is_creator') ?? $this->request->getPost('is_creator') ?? ($json['is_creator'] ?? null));

        if (!$cmpId || (int) $cmpId <= 0) {
            return null;
        }
        if ($requireFy && (!$fyId || (int) $fyId <= 0)) {
            return null;
        }
        $bo = (int) $boId;
        if ($bo < 0) {
            return null;
        }

        $ctx = [
            'cmp_id' => (int) $cmpId,
            'fy_id'  => (int) ($fyId ?? 0),
            'bo_id'  => $bo,
        ];
        $resolved = (new ManageCompanyAccessMapper())->resolveFromRow([
            'acs_type'   => ($acsType !== null && $acsType !== '') ? $acsType : null,
            'ownership'  => ($ownership !== null && $ownership !== '') ? $ownership : null,
            'is_creator' => ($isCreator !== null && $isCreator !== '') ? $isCreator : null,
        ]);
        if ($resolved !== null) {
            $ctx['acs_type'] = $resolved;
        }

        return $ctx;
    }
}
