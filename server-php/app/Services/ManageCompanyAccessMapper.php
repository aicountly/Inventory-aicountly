<?php

namespace App\Services;

/**
 * Maps Manage company API fields → Books portal access (acs_type 1 = owner, 0 = delegated).
 *
 * Manage list payload uses ownership ("owner") and is_creator (true), not acs_type.
 */
class ManageCompanyAccessMapper
{
    /** @param array<string, mixed> $row */
    public function resolveFromRow(array $row): ?int
    {
        if (array_key_exists('acs_type', $row)) {
            $parsed = $this->normalizeNumeric($row['acs_type']);
            if ($parsed !== null) {
                return $parsed;
            }
        }

        if (array_key_exists('ownership', $row)) {
            $parsed = $this->parseLabel($row['ownership']);
            if ($parsed !== null) {
                return $parsed;
            }
        }

        foreach (['access', 'access_name', 'access_label', 'access_type_name', 'acs_name', 'comp_access'] as $key) {
            if (!array_key_exists($key, $row)) {
                continue;
            }
            $parsed = $this->parseLabel($row[$key]);
            if ($parsed !== null) {
                return $parsed;
            }
        }

        if (array_key_exists('access_type', $row)) {
            $parsed = $this->normalizeNumeric($row['access_type']);
            if ($parsed !== null) {
                return $parsed;
            }
        }

        if ($this->isTruthy($row['is_creator'] ?? null)) {
            return 1;
        }

        return null;
    }

    /** @param array<string, mixed>|null $session */
    public function sessionIsPortalOwner(?array $session): bool
    {
        if ($session === null) {
            return false;
        }
        if ((int) ($session['acs_type'] ?? 0) === 1) {
            return true;
        }

        return $this->resolveFromRow($session) === 1;
    }

    public function parseLabel(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (is_numeric($value)) {
            $n = (int) $value;
            return $n === 1 ? 1 : ($n === 0 ? 0 : null);
        }
        $label = strtolower(trim((string) $value));
        if ($label === 'owner') {
            return 1;
        }
        if (in_array($label, ['shared', 'delegated', 'user', 'viewer', 'editor', 'member'], true)) {
            return 0;
        }

        return null;
    }

    protected function normalizeNumeric(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        return (int) $value;
    }

    protected function isTruthy(mixed $value): bool
    {
        if ($value === true || $value === 1) {
            return true;
        }
        if (is_string($value)) {
            $v = strtolower(trim($value));
            return in_array($v, ['1', 'true', 'yes'], true);
        }

        return false;
    }
}
