<?php

namespace App\Services;

use Config\PermissionRegistry;

/**
 * Company-scoped RBAC for Inventory.
 *
 *  - Portal owners (acs_type = 1 from the portal / Manage) bypass permission checks.
 *  - Trusted product backends (service-key sessions) are pre-authorised: the calling
 *    product already enforced its own permission for the human it acts for.
 *  - Everyone else needs an active inv_company_members row whose profile carries the key.
 *  - The first human to enter a company with no members becomes its Owner (mirrors Books).
 */
class AccessService
{
    public function assert(string $uuid, array $ctx, string $permission, ?array $session = null): void
    {
        $cmpId = (int) ($ctx['cmp_id'] ?? 0);
        if ($cmpId <= 0) {
            throw new \RuntimeException('Company context required', 400);
        }
        if (($session['kind'] ?? '') === 'service') {
            return;
        }
        if ($this->isBypassActive()) {
            $this->ensureMemberBootstrap($uuid, $cmpId, $session);

            return;
        }
        $this->ensureMemberBootstrap($uuid, $cmpId, $session);
        if ($this->isPortalOwner($session)) {
            return;
        }
        $member = $this->getActiveMember($uuid, $cmpId);
        if (!$member) {
            throw new \RuntimeException('No Inventory access profile assigned', 403);
        }
        if (!$this->profileHasPermission((int) $member['profile_id'], $permission)) {
            throw new \RuntimeException('Permission denied: ' . $permission, 403);
        }
    }

    public function hasPermission(string $uuid, int $cmpId, string $permission, ?array $session = null): bool
    {
        try {
            $this->assert($uuid, ['cmp_id' => $cmpId], $permission, $session);

            return true;
        } catch (\RuntimeException) {
            return false;
        }
    }

    /** @return array{allowed: bool, message?: string} */
    public function check(string $uuid, array $ctx, ?array $session = null): array
    {
        try {
            $this->assert($uuid, $ctx, 'inventory.enter', $session);

            return ['allowed' => true];
        } catch (\RuntimeException $e) {
            return ['allowed' => false, 'message' => $e->getMessage()];
        }
    }

    /** @return array{member: ?array, profile: ?array, permissions: list<string>, allowed_warehouses: ?list<int>} */
    public function getMe(string $uuid, array $ctx, ?array $session = null): array
    {
        $cmpId = (int) $ctx['cmp_id'];
        $this->ensureMemberBootstrap($uuid, $cmpId, $session);
        if ($this->isPortalOwner($session)) {
            return [
                'member' => ['uuid' => $uuid, 'status' => 'active', 'profile_id' => null, 'is_portal_owner' => true],
                'profile' => ['template_key' => 'owner', 'profile_name' => 'Owner'],
                'permissions' => PermissionRegistry::allKeys(),
                'allowed_warehouses' => null,
            ];
        }
        $member = $this->getActiveMember($uuid, $cmpId);
        if (!$member) {
            return ['member' => null, 'profile' => null, 'permissions' => [], 'allowed_warehouses' => null];
        }
        $profile = $this->getProfile((int) $member['profile_id'], $cmpId);
        $permissions = ($profile['template_key'] ?? '') === 'owner'
            ? PermissionRegistry::allKeys()
            : $this->getEffectivePermissions((int) $member['profile_id']);
        $allowed = null;
        if (!empty($member['allowed_warehouses_json'])) {
            $decoded = json_decode((string) $member['allowed_warehouses_json'], true);
            $allowed = is_array($decoded) ? array_values(array_map('intval', $decoded)) : null;
        }

        return [
            'member' => [
                'uuid'         => $member['uuid'],
                'status'       => $member['status'],
                'profile_id'   => (int) $member['profile_id'],
                'display_name' => $member['display_name'] ?? null,
                'email'        => $member['email'] ?? null,
            ],
            'profile'     => $profile,
            'permissions' => $permissions,
            'allowed_warehouses' => $allowed,
        ];
    }

    /**
     * Warehouse restriction: null = unrestricted.
     *
     * @return list<int>|null
     */
    public function allowedWarehouses(string $uuid, int $cmpId, ?array $session = null): ?array
    {
        if (($session['kind'] ?? '') === 'service' || $this->isPortalOwner($session)) {
            return null;
        }
        $member = $this->getActiveMember($uuid, $cmpId);
        if (!$member || empty($member['allowed_warehouses_json'])) {
            return null;
        }
        $decoded = json_decode((string) $member['allowed_warehouses_json'], true);

        return is_array($decoded) && $decoded !== [] ? array_values(array_map('intval', $decoded)) : null;
    }

    /** @return list<string> */
    public function getEffectivePermissions(int $profileId): array
    {
        $rows = \Config\Database::connect()->table('inv_access_profile_permissions')
            ->select('permission_key')
            ->where('profile_id', $profileId)
            ->where('allowed', 1)
            ->get()->getResultArray();

        return array_values(array_unique(array_column($rows, 'permission_key')));
    }

    public function isPortalOwner(?array $session): bool
    {
        return (new ManageCompanyAccessMapper())->sessionIsPortalOwner($session);
    }

    public function isBypassActive(): bool
    {
        $env = getenv('INVENTORY_ACCESS_BYPASS');

        return $env !== false && trim((string) $env) === '1';
    }

    /** @return array<string, mixed>|null */
    public function getActiveMember(string $uuid, int $cmpId): ?array
    {
        $db = \Config\Database::connect();
        if (!SchemaCache::tableExists($db, 'inv_company_members')) {
            return null;
        }
        $row = $db->table('inv_company_members')
            ->where('cmp_id', $cmpId)
            ->where('uuid', $uuid)
            ->whereIn('status', ['active', 'invited'])
            ->get()->getRowArray();

        return $row ?: null;
    }

    protected function profileHasPermission(int $profileId, string $permission): bool
    {
        $db = \Config\Database::connect();
        $profile = $db->table('inv_access_profiles')->where('profile_id', $profileId)->where('is_active', 1)->get()->getRowArray();
        if (!$profile) {
            return false;
        }
        if (($profile['template_key'] ?? '') === 'owner') {
            return true;
        }
        $count = $db->table('inv_access_profile_permissions')
            ->where('profile_id', $profileId)
            ->where('permission_key', $permission)
            ->where('allowed', 1)
            ->countAllResults();

        return $count > 0;
    }

    /** @return array<string, mixed>|null */
    protected function getProfile(int $profileId, int $cmpId): ?array
    {
        $row = \Config\Database::connect()->table('inv_access_profiles')
            ->where('profile_id', $profileId)
            ->where('cmp_id', $cmpId)
            ->get()->getRowArray();
        if (!$row) {
            return null;
        }

        return [
            'profile_id'   => (int) $row['profile_id'],
            'profile_name' => $row['profile_name'],
            'template_key' => $row['template_key'] ?? null,
            'is_system'    => (int) ($row['is_system'] ?? 0),
            'description'  => $row['description'] ?? null,
        ];
    }

    public function ensureMemberBootstrap(string $uuid, int $cmpId, ?array $session = null): void
    {
        try {
            $db = \Config\Database::connect();
            if (!SchemaCache::tableExists($db, 'inv_company_members')) {
                return;
            }
            $templates = new AccessProfileTemplateService();
            $templates->ensureSystemProfiles($cmpId);
            (new InventorySettingsService())->ensureForCompany($cmpId);

            $existing = $db->table('inv_company_members')->select('id, status')->where('cmp_id', $cmpId)->where('uuid', $uuid)->get()->getRowArray();
            if ($existing) {
                if (($existing['status'] ?? '') === 'invited') {
                    $db->table('inv_company_members')->where('id', (int) $existing['id'])->update([
                        'status' => 'active', 'accepted_at' => date('Y-m-d H:i:s'), 'updated_at' => date('Y-m-d H:i:s'),
                    ]);
                }

                return;
            }

            $memberCount = (int) $db->table('inv_company_members')->where('cmp_id', $cmpId)->countAllResults();
            $now = date('Y-m-d H:i:s');
            if ($memberCount === 0) {
                $owner = $templates->getProfileByTemplate($cmpId, 'owner');
                if ($owner) {
                    $db->table('inv_company_members')->insert([
                        'cmp_id' => $cmpId, 'uuid' => $uuid, 'profile_id' => (int) $owner['profile_id'],
                        'status' => 'active', 'accepted_at' => $now, 'created_at' => $now, 'updated_at' => $now,
                    ]);
                }

                return;
            }
            if ($this->isPortalOwner($session)) {
                $admin = $templates->getProfileByTemplate($cmpId, 'administrator');
                if ($admin) {
                    $db->table('inv_company_members')->insert([
                        'cmp_id' => $cmpId, 'uuid' => $uuid, 'profile_id' => (int) $admin['profile_id'],
                        'status' => 'active', 'accepted_at' => $now, 'created_at' => $now, 'updated_at' => $now,
                    ]);
                }
            }
        } catch (\Throwable $e) {
            log_message('error', 'ensureMemberBootstrap cmp_id=' . $cmpId . ': ' . $e->getMessage());
        }
    }
}
