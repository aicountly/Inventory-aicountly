/** `/v1/access/*` administration: permission catalog, access profiles and team members. */

import { api } from './api'
import type { ItemResponse } from './api'

export interface CatalogPermission {
  key: string
  label: string
  action: string
}

export interface CatalogGroup {
  id: string
  label: string
  permissions: CatalogPermission[]
}

export interface ProfileTemplate {
  template_key: string
  profile_name: string
  description: string
}

export interface PermissionCatalog {
  groups: CatalogGroup[]
  templates: ProfileTemplate[]
}

export interface AccessProfileRow {
  profile_id: number
  cmp_id: number
  profile_name: string
  description: string | null
  template_key: string | null
  is_system: number | string
  is_active: number | string
  created_at: string | null
  updated_at: string | null
  permissions: string[]
  member_count: number
}

export type MemberStatus = 'active' | 'invited' | 'revoked'
export const MEMBER_STATUSES: MemberStatus[] = ['active', 'invited', 'revoked']

export interface MemberRow {
  id: number
  cmp_id: number
  uuid: string
  profile_id: number
  status: MemberStatus | string
  display_name: string | null
  email: string | null
  allowed_warehouses: number[] | null
  invited_by: string | null
  invited_at: string | null
  accepted_at: string | null
  created_at: string | null
  updated_at: string | null
  profile_name: string | null
  template_key: string | null
}

export interface ProvisionMemberPayload {
  uuid: string
  profile_id?: number
  template_key?: string
  status?: MemberStatus
  display_name?: string | null
  email?: string | null
  allowed_warehouses?: number[]
}

export const accessAdminApi = {
  async catalog(signal?: AbortSignal): Promise<PermissionCatalog> {
    const res = await api.get<ItemResponse<PermissionCatalog>>('v1/access/permissions', { signal })
    return { groups: res.data?.groups ?? [], templates: res.data?.templates ?? [] }
  },

  async profiles(signal?: AbortSignal): Promise<AccessProfileRow[]> {
    const res = await api.get<{ data: AccessProfileRow[] }>('v1/access/profiles', { signal })
    return Array.isArray(res.data) ? res.data : []
  },

  async createProfile(body: { profile_name: string; description?: string | null; permissions: string[] }): Promise<{ profile_id: number }> {
    const res = await api.post<ItemResponse<{ profile_id: number }>>('v1/access/profiles', body)
    return res.data
  },

  async updateProfile(id: number, body: { profile_name?: string; description?: string | null; is_active?: boolean }): Promise<{ profile_id: number }> {
    const res = await api.put<ItemResponse<{ profile_id: number }>>(`v1/access/profiles/${id}`, body)
    return res.data
  },

  async setPermissions(id: number, permissions: string[]): Promise<{ profile_id: number; permissions: string[] }> {
    const res = await api.put<ItemResponse<{ profile_id: number; permissions: string[] }>>(`v1/access/profiles/${id}/permissions`, { permissions })
    return res.data
  },

  async members(signal?: AbortSignal): Promise<MemberRow[]> {
    const res = await api.get<{ data: MemberRow[] }>('v1/access/members', { signal })
    return Array.isArray(res.data) ? res.data : []
  },

  async provisionMember(body: ProvisionMemberPayload): Promise<{ uuid: string; profile_id: number; status: string }> {
    const res = await api.post<ItemResponse<{ uuid: string; profile_id: number; status: string }>>('v1/access/members', body)
    return res.data
  },

  async removeMember(uuid: string): Promise<void> {
    await api.delete<unknown>(`v1/access/members/${encodeURIComponent(uuid)}`)
  },
}
