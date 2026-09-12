<?php

namespace App\Services\Migration;

/**
 * Source (Books) -> destination (Inventory) table and column mapping. Primary keys are preserved
 * value-for-value; every migrated row records legacy_source_table / legacy_source_id and lands in
 * inv_legacy_id_map. Order matters: masters first, then documents, lines, valuation, state.
 */
class TableMap
{
    /** Books tables that are inventory-owned and are copied (source => destination). */
    public const MASTERS = [
        'books_item_groups'            => ['dest' => 'inv_item_groups',      'pk' => 'item_grp_id',        'dest_pk' => 'item_grp_id'],
        'books_stock_categories'       => ['dest' => 'inv_stock_categories', 'pk' => 'stock_cat_id',       'dest_pk' => 'stock_cat_id'],
        'books_item_units'             => ['dest' => 'inv_uom',              'pk' => 'unit_id',            'dest_pk' => 'unit_id'],
        'books_material_centre_groups' => ['dest' => 'inv_warehouse_groups', 'pk' => 'mc_grp_id',          'dest_pk' => 'warehouse_group_id'],
        'books_material_centres'       => ['dest' => 'inv_warehouses',       'pk' => 'mc_id',              'dest_pk' => 'warehouse_id'],
        'books_items'                  => ['dest' => 'inv_items',            'pk' => 'item_id',            'dest_pk' => 'item_id'],
        'books_item_unit_lines'        => ['dest' => 'inv_item_uoms',        'pk' => 'item_unit_line_id',  'dest_pk' => 'item_unit_line_id'],
        'books_bom_headers'            => ['dest' => 'inv_bom_headers',      'pk' => 'bom_id',             'dest_pk' => 'bom_id'],
        'books_bom_lines'              => ['dest' => 'inv_bom_lines',        'pk' => 'bom_line_id',        'dest_pk' => 'bom_line_id'],
    ];

    /** Transaction / state tables. */
    public const TRANSACTIONS = [
        'books_voucher_headers (item-bearing)' => ['dest' => 'inv_documents',            'pk' => 'vch_txn_id',   'dest_pk' => 'document_id'],
        'books_voucher_inventory_lines'        => ['dest' => 'inv_document_lines',       'pk' => 'inv_line_id',  'dest_pk' => 'line_id'],
        'books_voucher_packing_lines'          => ['dest' => 'inv_document_lines',       'pk' => 'packing_line_id', 'dest_pk' => 'line_id (offset)'],
        'books_voucher_job_work_lines'         => ['dest' => 'inv_document_lines',       'pk' => 'line_id',      'dest_pk' => 'line_id (offset)'],
        'books_voucher_packing_meta'           => ['dest' => 'inv_packing_meta',         'pk' => 'vch_txn_id',   'dest_pk' => 'document_id'],
        'books_inventory_cost_layers'          => ['dest' => 'inv_cost_layers',          'pk' => 'layer_id',     'dest_pk' => 'layer_id'],
        'books_inventory_wac_state'            => ['dest' => 'inv_wac_state',            'pk' => '(cmp_id,item_id)', 'dest_pk' => '(cmp_id,item_id,0)'],
        'books_stock_bucket_balances'          => ['dest' => 'inv_stock_balances',       'pk' => 'balance_id',   'dest_pk' => 'balance_id'],
        'books_stock_bucket_ledger'            => ['dest' => 'inv_stock_status_movements','pk' => 'ledger_id',   'dest_pk' => 'ledger_id'],
        'books_inventory_pending'              => ['dest' => 'inv_pending_quantities',   'pk' => 'pending_id',   'dest_pk' => 'pending_id'],
        'books_inventory_settlement'           => ['dest' => 'inv_pending_settlements',  'pk' => 'settlement_id','dest_pk' => 'settlement_id'],
        'books_item_fy_openings'               => ['dest' => 'inv_item_openings',        'pk' => 'item_fy_opening_id', 'dest_pk' => 'opening_id'],
        'books_item_unit_lines (opening_qty>0)'=> ['dest' => 'inv_item_openings (fy_id=0)', 'pk' => 'item_unit_line_id', 'dest_pk' => 'opening_id (offset)'],
        'books_fy_carryforward'                => ['dest' => 'inv_fy_carryforward_status','pk' => 'carryforward_id', 'dest_pk' => 'id'],
        'books_movement_document_snapshots'    => ['dest' => 'inv_document_snapshots',   'pk' => 'snap_id',      'dest_pk' => 'snap_id'],
        'books_company_settings.default_stock' => ['dest' => 'inv_company_settings',     'pk' => 'cmp_id',       'dest_pk' => 'cmp_id'],
    ];

    /** Books tables intentionally RETAINED in Books (financial truth) — validated, never moved. */
    public const RETAINED_IN_BOOKS = [
        'books_voucher_headers' => 'accounting voucher header (kept; item-bearing rows also mirrored as inv_documents)',
        'books_voucher_lines' => 'ledger debits/credits incl. COGS / Stock-in-Hand pairs',
        'books_voucher_inventory_lines' => 'COMMERCIAL item lines of sales/purchase/CN/DN/journal (rate, amount, tax); inventory-only columns frozen',
        'books_voucher_tax_lines' => 'GST',
        'books_voucher_service_lines' => 'service lines',
        'books_voucher_bill_sundry_lines' => 'bill sundries',
        'books_bills' => 'bill-by-bill', 'books_bill_settlements' => 'bill-by-bill', 'books_bill_voucher_effects' => 'bill-by-bill',
        'books_voucher_line_cc_allocations' => 'cost centres', 'books_voucher_line_subledger_allocations' => 'sub-ledgers',
        'books_credit_note_details' => 'CN commercial', 'books_credit_note_line_details' => 'CN commercial (references inv_line_id, preserved)',
        'books_debit_note_details' => 'DN commercial', 'books_debit_note_line_details' => 'DN commercial (references inv_line_id, preserved)',
        'books_item_gst_profile_history' => 'GST classification history per item (references item_id, preserved)',
        'books_tax_categories' => 'tax master', 'books_gst_party_item_memory' => 'GST', 'books_gst_itc04_movements' => 'GST ITC-04',
        'books_sales_invoice_snapshots' => 'print snapshot', 'books_purchase_invoice_snapshots' => 'print snapshot',
        'books_credit_note_snapshots' => 'print snapshot', 'books_debit_note_snapshots' => 'print snapshot',
        'books_inventory_cost_layers' => 'kept read-only after cutover (source of truth moved to inv_cost_layers)',
        'books_inventory_wac_state' => 'kept read-only after cutover',
        'books_stock_bucket_balances' => 'kept read-only after cutover', 'books_stock_bucket_ledger' => 'kept read-only after cutover',
        'books_inventory_pending' => 'kept read-only after cutover', 'books_inventory_settlement' => 'kept read-only after cutover',
        'books_item_fy_openings' => 'kept read-only after cutover', 'books_item_unit_lines' => 'kept read-only after cutover',
        'books_movement_document_snapshots' => 'kept read-only after cutover',
    ];

    /** Books voucher types whose posted vouchers become inventory documents. */
    public const ITEM_BEARING_TYPES = [2, 3, 4, 5, 6, 7, 10, 11, 14, 15, 18, 20, 23, 24];

    /** Pure-inventory voucher types (removed from Books UI after cutover). */
    public const PURE_INVENTORY_TYPES = [4, 6, 7, 10, 14, 15, 20, 23, 24];

    /** Offsets used when two Books tables land in one Inventory table (deterministic, logged). */
    public const LINE_ID_OFFSET_PACKING = 1_000_000_000;
    public const LINE_ID_OFFSET_JOB_WORK = 2_000_000_000;
    public const OPENING_ID_OFFSET_INCEPTION = 1_000_000_000;
}
