<?php

namespace App\Services;

use Config\PermissionRegistry;

/**
 * Seeds and repairs the system access profiles of a company (inv_access_profiles).
 */
class AccessProfileTemplateService
{
    public function ensureSystemProfiles(int $cmpId): void
    {
        $db = \Config\Database::connect();
        if (!SchemaCache::tableExists($db, 'inv_access_profiles')) {
            return;
        }
        foreach (PermissionRegistry::systemTemplates() as $tpl) {
            $existing = $db->table('inv_access_profiles')
                ->where('cmp_id', $cmpId)
                ->where('template_key', $tpl['template_key'])
                ->where('deleted_at', null)
                ->orderBy('profile_id', 'ASC')
                ->get()->getRowArray();
            if ($existing) {
                $this->syncMissingTemplatePermissions((int) $existing['profile_id'], $tpl['template_key']);
                continue;
            }
            $now = date('Y-m-d H:i:s');
            $db->table('inv_access_profiles')->insert([
                'cmp_id'       => $cmpId,
                'profile_name' => $tpl['profile_name'],
                'description'  => $tpl['description'],
                'template_key' => $tpl['template_key'],
                'is_system'    => 1,
                'is_active'    => 1,
                'created_at'   => $now,
                'updated_at'   => $now,
            ]);
            $profileId = (int) $db->insertID();
            $this->replacePermissions($profileId, PermissionRegistry::templatePermissions($tpl['template_key']));
        }
    }

    /** @return array<string, mixed>|null */
    public function getProfileByTemplate(int $cmpId, string $templateKey): ?array
    {
        $row = \Config\Database::connect()->table('inv_access_profiles')
            ->where('cmp_id', $cmpId)
            ->where('template_key', $templateKey)
            ->where('is_active', 1)
            ->where('deleted_at', null)
            ->orderBy('profile_id', 'ASC')
            ->get()->getRowArray();

        return $row ?: null;
    }

    /** @param list<string> $permissionKeys */
    public function replacePermissions(int $profileId, array $permissionKeys): void
    {
        $db = \Config\Database::connect();
        $db->table('inv_access_profile_permissions')->where('profile_id', $profileId)->delete();
        $rows = [];
        foreach (array_values(array_unique($permissionKeys)) as $key) {
            $rows[] = ['profile_id' => $profileId, 'permission_key' => $key, 'allowed' => 1];
        }
        if ($rows !== []) {
            $db->table('inv_access_profile_permissions')->insertBatch($rows);
        }
    }

    public function syncMissingTemplatePermissions(int $profileId, string $templateKey): void
    {
        $db = \Config\Database::connect();
        $have = array_column(
            $db->table('inv_access_profile_permissions')->select('permission_key')->where('profile_id', $profileId)->get()->getResultArray(),
            'permission_key'
        );
        $missing = array_diff(PermissionRegistry::templatePermissions($templateKey), $have);
        $rows = [];
        foreach ($missing as $key) {
            $rows[] = ['profile_id' => $profileId, 'permission_key' => $key, 'allowed' => 1];
        }
        if ($rows !== []) {
            $db->table('inv_access_profile_permissions')->insertBatch($rows);
        }
    }
}
