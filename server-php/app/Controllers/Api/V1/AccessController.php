<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\AccessProfileTemplateService;
use App\Services\AuditService;
use Config\PermissionRegistry;

class AccessController extends BaseController
{
    public function session()
    {
        $s = $this->auth();
        if (!$s) {
            return $this->failUnauthorized('Invalid or expired session');
        }

        return $this->respond(['authenticated' => true, 'uuid' => $s['uuid'], 'kind' => $s['kind']]);
    }

    public function check()
    {
        $a = $this->authorize(null, true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }

        return $this->respond(['data' => $this->access->check($a['session']['uuid'], $a['ctx'], $a['session'])]);
    }

    public function me()
    {
        $a = $this->authorize(null, true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }

        return $this->respond(['data' => $this->access->getMe($a['session']['uuid'], $a['ctx'], $a['session'])]);
    }

    public function permissionsCatalog()
    {
        $a = $this->authorize('inventory.enter', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }

        return $this->respond(['data' => ['groups' => PermissionRegistry::catalog(), 'templates' => PermissionRegistry::systemTemplates()]]);
    }

    public function profiles()
    {
        $a = $this->authorize('access.manage', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        (new AccessProfileTemplateService())->ensureSystemProfiles($cmpId);
        $db = \Config\Database::connect();
        $rows = $db->table('inv_access_profiles')->where('cmp_id', $cmpId)->where('deleted_at', null)->orderBy('is_system', 'DESC')->orderBy('profile_name')->get()->getResultArray();
        $memberCounts = [];
        foreach ($db->table('inv_company_members')->select('profile_id, COUNT(*) AS n')->where('cmp_id', $cmpId)->whereIn('status', ['active', 'invited'])->groupBy('profile_id')->get()->getResultArray() as $mc) {
            $memberCounts[(int) $mc['profile_id']] = (int) $mc['n'];
        }
        foreach ($rows as &$r) {
            $r['permissions'] = $this->access->getEffectivePermissions((int) $r['profile_id']);
            $r['member_count'] = $memberCounts[(int) $r['profile_id']] ?? 0;
        }
        unset($r);

        return $this->respond(['data' => $rows]);
    }

    public function createProfile()
    {
        $a = $this->authorize('access.manage', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $body = $this->request->getJSON(true) ?? [];
        $name = trim((string) ($body['profile_name'] ?? ''));
        if ($name === '') {
            return $this->failStructured(422, 'validation_failed', 'profile_name is required');
        }
        $db = \Config\Database::connect();
        $db->table('inv_access_profiles')->insert(['cmp_id' => (int) $a['ctx']['cmp_id'], 'profile_name' => $name, 'description' => $body['description'] ?? null, 'template_key' => null, 'is_system' => 0, 'is_active' => 1, 'created_at' => date('Y-m-d H:i:s'), 'updated_at' => date('Y-m-d H:i:s')]);
        $id = (int) $db->insertID();
        $keys = array_values(array_intersect((array) ($body['permissions'] ?? []), PermissionRegistry::allKeys()));
        (new AccessProfileTemplateService())->replacePermissions($id, $keys ?: ['inventory.enter']);
        (new AuditService())->log((int) $a['ctx']['cmp_id'], 'access_profile', $id, 'profile.create', $a['session']['uuid'], [], null, ['profile_name' => $name]);

        return $this->respondCreated(['data' => ['profile_id' => $id]]);
    }

    public function updateProfile($id = null)
    {
        $a = $this->authorize('access.manage', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $body = $this->request->getJSON(true) ?? [];
        $update = [];
        foreach (['profile_name', 'description', 'is_active'] as $k) {
            if (array_key_exists($k, $body)) {
                $update[$k] = $k === 'is_active' ? (!empty($body[$k]) ? 1 : 0) : $body[$k];
            }
        }
        if ($update !== []) {
            $update['updated_at'] = date('Y-m-d H:i:s');
            \Config\Database::connect()->table('inv_access_profiles')->where('cmp_id', (int) $a['ctx']['cmp_id'])->where('profile_id', (int) $id)->where('is_system', 0)->update($update);
        }

        return $this->respond(['data' => ['profile_id' => (int) $id]]);
    }

    public function setPermissions($id = null)
    {
        $a = $this->authorize('access.manage', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $profile = \Config\Database::connect()->table('inv_access_profiles')->where('cmp_id', $cmpId)->where('profile_id', (int) $id)->get()->getRowArray();
        if (!$profile) {
            return $this->failStructured(404, 'not_found', 'Profile not found');
        }
        if (($profile['template_key'] ?? '') === 'owner') {
            return $this->failStructured(422, 'validation_failed', 'The Owner profile always holds every permission');
        }
        $body = $this->request->getJSON(true) ?? [];
        $keys = array_values(array_intersect((array) ($body['permissions'] ?? []), PermissionRegistry::allKeys()));
        (new AccessProfileTemplateService())->replacePermissions((int) $id, $keys);
        (new AuditService())->log($cmpId, 'access_profile', (int) $id, 'profile.permissions', $a['session']['uuid'], [], null, ['count' => count($keys)]);

        return $this->respond(['data' => ['profile_id' => (int) $id, 'permissions' => $keys]]);
    }

    public function members()
    {
        $a = $this->authorize('access.members.manage', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $rows = \Config\Database::connect()->table('inv_company_members m')->select('m.*, p.profile_name, p.template_key')
            ->join('inv_access_profiles p', 'p.profile_id = m.profile_id', 'left')
            ->where('m.cmp_id', (int) $a['ctx']['cmp_id'])->orderBy('m.created_at')->get()->getResultArray();
        foreach ($rows as &$r) {
            $r['allowed_warehouses'] = json_decode((string) ($r['allowed_warehouses_json'] ?? ''), true);
            unset($r['allowed_warehouses_json']);
        }

        return $this->respond(['data' => $rows]);
    }

    public function addMember()
    {
        return $this->provisionMember();
    }

    /** Called by Manage (service key) or an admin: {uuid, template_key?|profile_id?, status?, display_name?, email?, allowed_warehouses?} */
    public function provisionMember()
    {
        $a = $this->authorize('access.members.manage', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        $body = $this->request->getJSON(true) ?? [];
        $uuid = trim((string) ($body['uuid'] ?? ''));
        if ($uuid === '') {
            return $this->failStructured(422, 'validation_failed', 'uuid is required');
        }
        $templates = new AccessProfileTemplateService();
        $templates->ensureSystemProfiles($cmpId);
        $profileId = (int) ($body['profile_id'] ?? 0);
        if ($profileId <= 0) {
            $tpl = (string) ($body['template_key'] ?? 'store_keeper');
            $profile = $templates->getProfileByTemplate($cmpId, $tpl) ?? $templates->getProfileByTemplate($cmpId, 'store_keeper');
            $profileId = (int) ($profile['profile_id'] ?? 0);
        }
        $db = \Config\Database::connect();
        $now = date('Y-m-d H:i:s');
        $row = [
            'profile_id' => $profileId, 'status' => in_array($body['status'] ?? 'active', ['active', 'invited', 'revoked'], true) ? $body['status'] : 'active',
            'display_name' => $body['display_name'] ?? null, 'email' => $body['email'] ?? null,
            'allowed_warehouses_json' => isset($body['allowed_warehouses']) && is_array($body['allowed_warehouses']) && $body['allowed_warehouses'] !== [] ? json_encode(array_map('intval', $body['allowed_warehouses'])) : null,
            'updated_at' => $now,
        ];
        $existing = $db->table('inv_company_members')->where('cmp_id', $cmpId)->where('uuid', $uuid)->get()->getRowArray();
        if ($existing) {
            $db->table('inv_company_members')->where('id', (int) $existing['id'])->update($row);
        } else {
            $db->table('inv_company_members')->insert(array_merge(['cmp_id' => $cmpId, 'uuid' => $uuid, 'invited_by' => $a['session']['uuid'], 'invited_at' => $now, 'created_at' => $now], $row));
        }
        (new AuditService())->log($cmpId, 'member', 0, 'member.provision', $a['session']['uuid'], ['uuid' => $uuid], null, $row);

        return $this->respond(['data' => ['uuid' => $uuid, 'profile_id' => $profileId, 'status' => $row['status']]]);
    }

    public function updateMember($uuid = null)
    {
        return $this->provisionMember();
    }

    public function removeMember($uuid = null)
    {
        $a = $this->authorize('access.members.manage', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $cmpId = (int) $a['ctx']['cmp_id'];
        \Config\Database::connect()->table('inv_company_members')->where('cmp_id', $cmpId)->where('uuid', (string) $uuid)->update(['status' => 'revoked', 'updated_at' => date('Y-m-d H:i:s')]);
        (new AuditService())->log($cmpId, 'member', 0, 'member.revoke', $a['session']['uuid'], ['uuid' => $uuid]);

        return $this->respondDeleted(['data' => ['uuid' => $uuid, 'status' => 'revoked']]);
    }
}
