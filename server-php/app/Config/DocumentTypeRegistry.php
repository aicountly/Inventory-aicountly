<?php

namespace Config;

/**
 * Every inventory document type: how its lines move stock, whether it carries valuation,
 * which accounting effects it produces for Books, and which legacy Books voucher type it
 * was migrated from.
 *
 * line_mode:
 *   fixed_in / fixed_out   every line moves in / out
 *   by_line                each line carries its own direction (transfer, adjustment, production ...)
 *   transfer               one UI line = out of from_warehouse + in to to_warehouse
 *   status_only            no physical movement; changes a status bucket (packing, reservation)
 *   pending_only           no physical movement; opens a pending quantity (challan_only)
 */
class DocumentTypeRegistry
{
    public const TYPES = [
        // ---- native inventory documents ----------------------------------------------------
        'OPENING_STOCK'       => ['label' => 'Opening Stock',            'line_mode' => 'fixed_in',   'valuation' => true,  'cogs' => false, 'effects' => ['OPENING_STOCK'],        'legacy_vch_type' => null, 'native' => true],
        'STOCK_TRANSFER'      => ['label' => 'Stock Transfer',           'line_mode' => 'transfer',   'valuation' => true,  'cogs' => false, 'effects' => [],                       'legacy_vch_type' => 15,   'native' => true],
        'STOCK_JOURNAL'       => ['label' => 'Stock Journal',            'line_mode' => 'by_line',    'valuation' => true,  'cogs' => false, 'effects' => ['STOCK_ADJUSTMENT'],     'legacy_vch_type' => 20,   'native' => true],
        'PHYSICAL_ADJUSTMENT' => ['label' => 'Physical Stock Adjustment','line_mode' => 'by_line',    'valuation' => true,  'cogs' => false, 'effects' => ['STOCK_ADJUSTMENT'],     'legacy_vch_type' => 10,   'native' => true],
        'WRITE_OFF'           => ['label' => 'Stock Write-Off',          'line_mode' => 'fixed_out',  'valuation' => true,  'cogs' => false, 'effects' => ['STOCK_WRITE_OFF'],      'legacy_vch_type' => null, 'native' => true],
        'WRITE_IN'            => ['label' => 'Stock Write-In / Excess',  'line_mode' => 'fixed_in',   'valuation' => true,  'cogs' => false, 'effects' => ['STOCK_WRITE_IN'],       'legacy_vch_type' => null, 'native' => true],
        'CONSUMPTION'         => ['label' => 'Consumption',              'line_mode' => 'fixed_out',  'valuation' => true,  'cogs' => true,  'effects' => ['COGS_ISSUE'],           'legacy_vch_type' => null, 'native' => true],
        'MATERIAL_ISSUE'      => ['label' => 'Material Issue',           'line_mode' => 'fixed_out',  'valuation' => true,  'cogs' => true,  'effects' => ['COGS_ISSUE'],           'legacy_vch_type' => null, 'native' => true],
        'MATERIAL_RECEIPT'    => ['label' => 'Material Receipt',         'line_mode' => 'fixed_in',   'valuation' => true,  'cogs' => false, 'effects' => ['STOCK_WRITE_IN'],       'legacy_vch_type' => null, 'native' => true],
        'PRODUCTION'          => ['label' => 'Production',               'line_mode' => 'by_line',    'valuation' => true,  'cogs' => true,  'effects' => ['COGS_ISSUE'],           'legacy_vch_type' => 14,   'native' => true],
        'ASSEMBLY'            => ['label' => 'Assembly',                 'line_mode' => 'by_line',    'valuation' => true,  'cogs' => false, 'effects' => [],                       'legacy_vch_type' => null, 'native' => true],
        'DISASSEMBLY'         => ['label' => 'Disassembly',              'line_mode' => 'by_line',    'valuation' => true,  'cogs' => false, 'effects' => [],                       'legacy_vch_type' => null, 'native' => true],
        'JOB_WORK_OUT'        => ['label' => 'Job Work Outward',         'line_mode' => 'status_only','valuation' => false, 'cogs' => false, 'effects' => [],                       'legacy_vch_type' => 7,    'native' => true],
        'JOB_WORK_IN'         => ['label' => 'Job Work Inward',          'line_mode' => 'by_line',    'valuation' => true,  'cogs' => true,  'effects' => ['COGS_ISSUE'],           'legacy_vch_type' => 6,    'native' => true],
        'BATCH_ADJUSTMENT'    => ['label' => 'Batch Adjustment',         'line_mode' => 'by_line',    'valuation' => false, 'cogs' => false, 'effects' => [],                       'legacy_vch_type' => null, 'native' => true],
        'SERIAL_ADJUSTMENT'   => ['label' => 'Serial Adjustment',        'line_mode' => 'by_line',    'valuation' => false, 'cogs' => false, 'effects' => [],                       'legacy_vch_type' => null, 'native' => true],
        'REVALUATION'         => ['label' => 'Stock Revaluation',        'line_mode' => 'status_only','valuation' => true,  'cogs' => false, 'effects' => ['STOCK_REVALUATION'],    'legacy_vch_type' => null, 'native' => true],
        'LANDED_COST'         => ['label' => 'Landed Cost Allocation',   'line_mode' => 'status_only','valuation' => true,  'cogs' => false, 'effects' => ['LANDED_COST'],          'legacy_vch_type' => null, 'native' => true],
        'RESERVATION'         => ['label' => 'Inventory Reservation',    'line_mode' => 'status_only','valuation' => false, 'cogs' => false, 'effects' => [],                       'legacy_vch_type' => null, 'native' => true],
        'RESERVATION_RELEASE' => ['label' => 'Reservation Release',      'line_mode' => 'status_only','valuation' => false, 'cogs' => false, 'effects' => [],                       'legacy_vch_type' => null, 'native' => true],
        'DELIVERY_CHALLAN'    => ['label' => 'Delivery Challan / Dispatch','line_mode' => 'pending_only','valuation' => false,'cogs' => false, 'effects' => [],                     'legacy_vch_type' => 23,   'native' => true],
        'INWARD_CHALLAN'      => ['label' => 'Inward Challan / GRN',     'line_mode' => 'pending_only','valuation' => false,'cogs' => false, 'effects' => [],                       'legacy_vch_type' => 24,   'native' => true],
        'PACKING'             => ['label' => 'Packing List',             'line_mode' => 'status_only','valuation' => false, 'cogs' => false, 'effects' => [],                       'legacy_vch_type' => 4,    'native' => true],
        // ---- stock half of Books commercial vouchers ----------------------------------------
        'SALES_ISSUE'         => ['label' => 'Sales Issue',              'line_mode' => 'fixed_out',  'valuation' => true,  'cogs' => true,  'effects' => ['COGS_ISSUE'],           'legacy_vch_type' => 18,   'native' => false],
        'PURCHASE_RECEIPT'    => ['label' => 'Purchase Receipt',         'line_mode' => 'fixed_in',   'valuation' => true,  'cogs' => false, 'effects' => [],                       'legacy_vch_type' => 11,   'native' => false],
        'SALES_RETURN'        => ['label' => 'Sales Return (Credit Note)','line_mode' => 'fixed_in',  'valuation' => true,  'cogs' => false, 'effects' => [],                       'legacy_vch_type' => 2,    'native' => false],
        'PURCHASE_RETURN'     => ['label' => 'Purchase Return (Debit Note)','line_mode' => 'fixed_out','valuation' => true, 'cogs' => false, 'effects' => [],                       'legacy_vch_type' => 3,    'native' => false],
        'JOURNAL_ADJUSTMENT'  => ['label' => 'Journal with Item',        'line_mode' => 'by_line',    'valuation' => true,  'cogs' => true,  'effects' => ['COGS_ISSUE'],           'legacy_vch_type' => 5,    'native' => false],
    ];

    /** Books voucher type id -> document type, for migration and for commercial posting. */
    public const LEGACY_MAP = [
        2 => 'SALES_RETURN', 3 => 'PURCHASE_RETURN', 4 => 'PACKING', 5 => 'JOURNAL_ADJUSTMENT', 6 => 'JOB_WORK_IN', 7 => 'JOB_WORK_OUT',
        10 => 'PHYSICAL_ADJUSTMENT', 11 => 'PURCHASE_RECEIPT', 14 => 'PRODUCTION', 15 => 'STOCK_TRANSFER', 18 => 'SALES_ISSUE',
        20 => 'STOCK_JOURNAL', 23 => 'DELIVERY_CHALLAN', 24 => 'INWARD_CHALLAN',
    ];

    /**
     * Books voucher types whose direction was driven by the line's dr_cr rather than the type
     * (InventoryMovementClassifier::drCrDrivenTypeIds): 15, 20, 10, 14, 6.
     */
    public const LEGACY_DRCR_DRIVEN = [15, 20, 10, 14, 6];

    /** Books types that never produced a COGS ledger pair (StockValuationService::linesNeedCogsLedgerPosting). */
    public const LEGACY_NO_COGS = [15, 20, 10, 3];

    public static function get(string $type): ?array
    {
        return self::TYPES[strtoupper($type)] ?? null;
    }

    public static function isValid(string $type): bool
    {
        return isset(self::TYPES[strtoupper($type)]);
    }

    /** @return list<string> */
    public static function all(): array
    {
        return array_keys(self::TYPES);
    }

    /** @return list<string> */
    public static function nativeTypes(): array
    {
        return array_keys(array_filter(self::TYPES, static fn ($t) => $t['native']));
    }

    public static function fromLegacyVchType(int $vchTypeId): ?string
    {
        return self::LEGACY_MAP[$vchTypeId] ?? null;
    }

    public static function permissionSlug(string $type): string
    {
        return strtolower($type);
    }

    /** Legacy direction rule: given Books vch_type and dr_cr, in/out or null (identical to Books). */
    public static function legacyDirection(int $vchTypeId, int $drCr): ?string
    {
        if (in_array($vchTypeId, self::LEGACY_DRCR_DRIVEN, true)) {
            return $drCr === 1 ? 'in' : 'out';
        }

        return match ($vchTypeId) {
            11, 2, 24 => 'in',
            18, 3, 23, 7 => 'out',
            default => null,
        };
    }
}
