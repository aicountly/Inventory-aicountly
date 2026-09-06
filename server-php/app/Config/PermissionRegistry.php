<?php

namespace Config;

/**
 * Canonical Inventory permission keys.
 *
 * Shape mirrors Books' PermissionRegistry so Manage/portal tooling and the
 * shared access UI conventions carry over: `<module>.<action>`.
 */
class PermissionRegistry
{
    /** Masters (each gets read / write / delete). */
    public const MASTERS = [
        'items'            => 'Items',
        'item_groups'      => 'Item Groups',
        'stock_categories' => 'Stock Categories',
        'brands'           => 'Brands',
        'uom'              => 'Units of Measure',
        'warehouses'       => 'Warehouses / Material Centres',
        'warehouse_groups' => 'Warehouse Groups',
        'locations'        => 'Bins / Locations',
        'bill_of_materials'=> 'Bill of Materials',
        'batches'          => 'Batches / Lots',
        'serials'          => 'Serial Numbers',
    ];

    /** Document types (each gets read / create / edit / approve / post / reverse). */
    public const DOCUMENT_TYPES = [
        'opening_stock'         => 'Opening Stock',
        'stock_transfer'        => 'Stock Transfer',
        'stock_journal'         => 'Stock Journal',
        'physical_adjustment'   => 'Physical Stock Adjustment',
        'write_off'             => 'Stock Write-Off',
        'write_in'              => 'Stock Write-In / Excess',
        'consumption'           => 'Consumption',
        'material_issue'        => 'Material Issue',
        'material_receipt'      => 'Material Receipt',
        'production'            => 'Production',
        'assembly'              => 'Assembly',
        'disassembly'           => 'Disassembly',
        'job_work_out'          => 'Job Work Outward',
        'job_work_in'           => 'Job Work Inward',
        'batch_adjustment'      => 'Batch Adjustment',
        'serial_adjustment'     => 'Serial Adjustment',
        'revaluation'           => 'Stock Revaluation',
        'landed_cost'           => 'Landed Cost Allocation',
        'reservation'           => 'Inventory Reservation',
        'reservation_release'   => 'Reservation Release',
        'delivery_challan'      => 'Delivery Challan / Goods Dispatch',
        'inward_challan'        => 'Inward Challan / Goods Receipt Note',
        'packing'               => 'Packing List',
        'sales_issue'           => 'Sales Issue (from Books/Sales/POS)',
        'purchase_receipt'      => 'Purchase Receipt (from Books/Purchases)',
        'sales_return'          => 'Sales Return (Credit Note)',
        'purchase_return'       => 'Purchase Return (Debit Note)',
        'journal_adjustment'    => 'Journal with Item',
    ];

    public const DOCUMENT_ACTIONS = ['read', 'create', 'edit', 'approve', 'post', 'reverse'];

    public const REPORTS = [
        'stock_summary'      => 'Stock Summary',
        'stock_ledger'       => 'Stock Ledger',
        'warehouse_stock'    => 'Warehouse Stock',
        'batch_stock'        => 'Batch Stock',
        'serial_stock'       => 'Serial Stock',
        'stock_ageing'       => 'Stock Ageing',
        'movement_analysis'  => 'Fast / Slow / Non-moving',
        'near_expiry'        => 'Near Expiry',
        'valuation'          => 'Stock Valuation',
        'reconciliation'     => 'Inventory vs Books Reconciliation',
        'replenishment'      => 'Replenishment',
    ];

    /** @return list<string> */
    public static function allKeys(): array
    {
        $keys = [
            'inventory.enter',
            'access.manage',
            'access.members.manage',
            'dashboard.read',
            'settings.read',
            'settings.write',
            'periods.lock',
            'stock.negative_override',
            'stock.adjust',
            'stock.revalue',
            'valuation.recalculate',
            'reconciliation.read',
            'reconciliation.resolve',
            'audit.read',
            'audit.export',
            'integration.read',
            'integration.replay',
        ];
        foreach (self::MASTERS as $slug => $label) {
            foreach (['read', 'write', 'delete'] as $action) {
                $keys[] = 'masters.' . $slug . '.' . $action;
            }
        }
        foreach (['read', 'create', 'edit', 'approve', 'post', 'reverse', 'backdate'] as $action) {
            $keys[] = 'documents.' . $action;
        }
        foreach (self::DOCUMENT_TYPES as $slug => $label) {
            foreach (self::DOCUMENT_ACTIONS as $action) {
                $keys[] = 'documents.' . $slug . '.' . $action;
            }
        }
        foreach (self::REPORTS as $slug => $label) {
            $keys[] = 'reports.' . $slug . '.read';
        }
        $keys[] = 'warehouses.restrict';

        return array_values(array_unique($keys));
    }

    /** @return list<array{id:string,label:string,permissions:list<array{key:string,label:string,action:string}>}> */
    public static function catalog(): array
    {
        $groups = [
            'entry'      => ['id' => 'entry', 'label' => 'Entry & Administration', 'permissions' => []],
            'masters'    => ['id' => 'masters', 'label' => 'Masters', 'permissions' => []],
            'documents'  => ['id' => 'documents', 'label' => 'Inventory Documents', 'permissions' => []],
            'stock'      => ['id' => 'stock', 'label' => 'Stock Controls', 'permissions' => []],
            'reports'    => ['id' => 'reports', 'label' => 'Reports', 'permissions' => []],
            'operations' => ['id' => 'operations', 'label' => 'Operations', 'permissions' => []],
        ];
        $add = static function (string $g, string $key, string $label, string $action) use (&$groups): void {
            $groups[$g]['permissions'][] = ['key' => $key, 'label' => $label, 'action' => $action];
        };
        $add('entry', 'inventory.enter', 'Enter Inventory', 'access');
        $add('entry', 'access.manage', 'Manage access profiles', 'admin');
        $add('entry', 'access.members.manage', 'Manage team members', 'admin');
        $add('entry', 'dashboard.read', 'Dashboard', 'read');
        foreach (self::MASTERS as $slug => $label) {
            foreach (['read', 'write', 'delete'] as $action) {
                $add('masters', 'masters.' . $slug . '.' . $action, $label, $action);
            }
        }
        foreach (['read', 'create', 'edit', 'approve', 'post', 'reverse', 'backdate'] as $action) {
            $add('documents', 'documents.' . $action, 'All documents — ' . $action, $action);
        }
        foreach (self::DOCUMENT_TYPES as $slug => $label) {
            foreach (self::DOCUMENT_ACTIONS as $action) {
                $add('documents', 'documents.' . $slug . '.' . $action, $label, $action);
            }
        }
        $add('stock', 'stock.negative_override', 'Override negative-stock block', 'admin');
        $add('stock', 'stock.adjust', 'Post stock adjustments', 'write');
        $add('stock', 'stock.revalue', 'Revalue stock', 'write');
        $add('stock', 'valuation.recalculate', 'Run backdated valuation recalculation', 'admin');
        $add('stock', 'periods.lock', 'Lock / unlock inventory periods', 'admin');
        $add('stock', 'warehouses.restrict', 'Restricted to assigned warehouses', 'restrict');
        foreach (self::REPORTS as $slug => $label) {
            $add('reports', 'reports.' . $slug . '.read', $label, 'read');
        }
        $add('operations', 'settings.read', 'Inventory settings — view', 'read');
        $add('operations', 'settings.write', 'Inventory settings — edit', 'write');
        $add('operations', 'reconciliation.read', 'Books reconciliation — view', 'read');
        $add('operations', 'reconciliation.resolve', 'Books reconciliation — resolve / replay', 'write');
        $add('operations', 'integration.read', 'Integration events — view', 'read');
        $add('operations', 'integration.replay', 'Integration events — replay', 'admin');
        $add('operations', 'audit.read', 'Audit trail — view', 'read');
        $add('operations', 'audit.export', 'Audit trail — export', 'export');

        return array_values($groups);
    }

    /** @return list<string> */
    public static function templatePermissions(string $templateKey): array
    {
        $all = self::allKeys();
        $reads = array_values(array_filter($all, static fn ($k) => str_ends_with($k, '.read') || $k === 'inventory.enter'));
        $baseline = ['inventory.enter', 'dashboard.read'];
        $noRestrict = static fn (array $keys) => array_values(array_filter($keys, static fn ($k) => $k !== 'warehouses.restrict'));

        return match ($templateKey) {
            'owner' => $noRestrict($all),
            'administrator' => $noRestrict(array_values(array_filter($all, static fn ($k) => $k !== 'access.manage'))),
            'inventory_manager' => $noRestrict(array_values(array_filter($all, static fn ($k) => !in_array($k, ['access.manage', 'access.members.manage', 'settings.write', 'periods.lock'], true)))),
            'store_keeper' => array_values(array_unique(array_merge(
                $baseline,
                $reads,
                ['documents.read', 'documents.create', 'documents.edit', 'documents.post'],
                array_values(array_filter($all, static fn ($k) => preg_match('/^documents\.(stock_transfer|physical_adjustment|material_issue|material_receipt|delivery_challan|inward_challan|packing|job_work_out|job_work_in|consumption)\.(read|create|edit|post)$/', $k) === 1)),
            ))),
            'accountant' => array_values(array_unique(array_merge(
                $baseline,
                $reads,
                ['reconciliation.resolve', 'valuation.recalculate', 'documents.read'],
            ))),
            'view_only' => $reads,
            default => ['inventory.enter'],
        };
    }

    /** @return list<array{template_key:string,profile_name:string,description:string}> */
    public static function systemTemplates(): array
    {
        return [
            ['template_key' => 'owner', 'profile_name' => 'Owner', 'description' => 'Full access including access management'],
            ['template_key' => 'administrator', 'profile_name' => 'Administrator', 'description' => 'Full operational access without access admin'],
            ['template_key' => 'inventory_manager', 'profile_name' => 'Inventory Manager', 'description' => 'Masters, all documents, approvals, adjustments, valuation'],
            ['template_key' => 'store_keeper', 'profile_name' => 'Store Keeper', 'description' => 'Operational stock documents and stock views'],
            ['template_key' => 'accountant', 'profile_name' => 'Accountant', 'description' => 'Read access, valuation recalculation and reconciliation'],
            ['template_key' => 'view_only', 'profile_name' => 'View Only', 'description' => 'Read-only access across modules'],
        ];
    }

    /** Permission key for a document type + action; falls back to the generic key. */
    public static function documentPermission(string $docType, string $action): string
    {
        return 'documents.' . strtolower($docType) . '.' . $action;
    }
}
