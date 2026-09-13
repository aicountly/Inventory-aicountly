<?php

namespace App\Services;

/**
 * Statutory audit retention policy for Inventory.
 *
 * Deliberately the same shape and the same numbers as Books' AuditRetentionRegistry. Inventory
 * owns the stock domain Books used to own, so the audit of that domain is the other half of one
 * record: a company whose Books history is kept for eight years and whose Inventory history is
 * discarded has been half audited, which is worse than either answer on its own.
 *
 * Books splits hot from warm (books_audit_log to books_audit_log_archive) because it holds
 * millions of rows. Inventory does not yet, so there is no hot cutoff here — only the floor
 * below which nothing may be purged, and mayPurge(), which says nothing may be.
 *
 * The rule is enforced twice over. Migration 007 puts a BEFORE DELETE trigger on inv_audit_log
 * and inv_access_audit_log so no application path can delete from them, and
 * InventoryPurgeCompany::RETAINED names them so a company purge skips them rather than failing
 * on them.
 */
class AuditRetentionRegistry
{
    public const RETENTION_YEARS = 8;

    /** The tables this policy covers. Kept in step with migration 007 and with the purge. */
    public const AUDIT_TABLES = [
        'inv_audit_log',
        'inv_access_audit_log',
    ];

    public function policyBlurb(): string
    {
        return 'Inventory audit trail retention: every stock movement, valuation change and access '
            . 'change is recorded and kept for at least ' . self::RETENTION_YEARS
            . ' years. Records are never purged before that period, including when the company '
            . 'that produced them is deleted.';
    }

    /** Earliest date a row could be considered for purging, once purging is ever allowed. */
    public function purgeEligibleBefore(?string $asOf = null): string
    {
        $ts = $asOf !== null ? strtotime($asOf) : time();
        if ($ts === false) {
            $ts = time();
        }

        return date('Y-m-d H:i:s', strtotime('-' . self::RETENTION_YEARS . ' years', $ts));
    }

    public function mayPurge(): bool
    {
        // Explicitly disabled for statutory compliance — the trigger in migration 007 enforces
        // the same answer at the database, so changing this alone would not make a purge work.
        return false;
    }
}
