-- Migration 005: Access management (mirrors Books' RBAC shape so Manage can provision the same way).

CREATE TABLE IF NOT EXISTS inv_access_profiles (
    profile_id      BIGSERIAL PRIMARY KEY,
    cmp_id          BIGINT NOT NULL,
    profile_name    VARCHAR(128) NOT NULL,
    description     TEXT NULL,
    template_key    VARCHAR(64) NULL,
    is_system       SMALLINT NOT NULL DEFAULT 0,
    is_active       SMALLINT NOT NULL DEFAULT 1,
    created_at      TIMESTAMP NULL,
    updated_at      TIMESTAMP NULL,
    deleted_at      TIMESTAMP NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_access_profiles_cmp ON inv_access_profiles (cmp_id, is_active);

CREATE TABLE IF NOT EXISTS inv_access_profile_permissions (
    id              BIGSERIAL PRIMARY KEY,
    profile_id      BIGINT NOT NULL,
    permission_key  VARCHAR(128) NOT NULL,
    allowed         SMALLINT NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_access_profile_permissions ON inv_access_profile_permissions (profile_id, permission_key);

CREATE TABLE IF NOT EXISTS inv_company_members (
    id              BIGSERIAL PRIMARY KEY,
    cmp_id          BIGINT NOT NULL,
    uuid            VARCHAR(64) NOT NULL,
    profile_id      BIGINT NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'active',
    display_name    VARCHAR(255) NULL,
    email           VARCHAR(255) NULL,
    allowed_warehouses_json JSONB NULL,         -- NULL = all warehouses
    invited_by      VARCHAR(64) NULL,
    invited_at      TIMESTAMP NULL,
    accepted_at     TIMESTAMP NULL,
    created_at      TIMESTAMP NULL,
    updated_at      TIMESTAMP NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_company_members_cmp_uuid ON inv_company_members (cmp_id, uuid);
CREATE INDEX IF NOT EXISTS idx_inv_company_members_cmp_status ON inv_company_members (cmp_id, status);

CREATE TABLE IF NOT EXISTS inv_access_audit_log (
    id              BIGSERIAL PRIMARY KEY,
    cmp_id          BIGINT NOT NULL,
    entity_type     VARCHAR(64) NOT NULL,
    entity_id       VARCHAR(64) NULL,
    action          VARCHAR(64) NOT NULL,
    actor_uuid      VARCHAR(64) NULL,
    meta_json       JSONB NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inv_access_audit_log_cmp ON inv_access_audit_log (cmp_id, created_at);
