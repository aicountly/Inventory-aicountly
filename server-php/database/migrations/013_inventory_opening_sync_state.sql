-- Migration 013: watermark for the opening-value push to Books.
--
-- One row per company/FY/branch the sync has actually enqueued a push for, so a company with
-- items entering their opening one at a time doesn't send Books a fresh event (and a rewritten
-- OB-M journal on that side) for every single item saved -- only when the resolved aggregate has
-- genuinely moved since the last push.

CREATE TABLE IF NOT EXISTS inv_opening_sync_state (
    cmp_id            BIGINT NOT NULL,
    fy_id             BIGINT NOT NULL,
    bo_id             BIGINT NOT NULL DEFAULT 0,
    last_pushed_value NUMERIC(18,4) NOT NULL DEFAULT 0,
    last_pushed_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cmp_id, fy_id, bo_id)
);
