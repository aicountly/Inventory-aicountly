<?php

namespace App\Services\Migration;

use CodeIgniter\Database\BaseConnection;

/**
 * After inserting preserved ids, every serial / identity sequence in the Inventory database is
 * reset so the next generated id is strictly greater than the current MAX. Sequence names are
 * derived from the catalog (pg_get_serial_sequence), never hard-coded.
 */
class SequenceResetter
{
    /**
     * (table, column) pairs whose PK mixes organic, sequence-generated ids with a permanently
     * reserved synthetic range — TableMap::LINE_ID_OFFSET_PACKING / LINE_ID_OFFSET_JOB_WORK on
     * inv_document_lines.line_id, TableMap::OPENING_ID_OFFSET_INCEPTION on
     * inv_item_openings.opening_id. Naively resetting the sequence to MAX(column) picks up the
     * synthetic offset instead of the true organic high-water mark, so every document line (or
     * opening) created after cutover would allocate ids inside the space reserved for migrated
     * packing / job-work lines (or inception openings) — silently colliding with a later
     * migration batch that legitimately needs that same offset range for a different company.
     * The reset must only ever consider ids below the lowest reserved offset.
     *
     * @var array<string, array<string, int>>
     */
    private const ORGANIC_ID_CEILING = [
        'inv_document_lines' => ['line_id' => TableMap::LINE_ID_OFFSET_PACKING],
        'inv_item_openings'  => ['opening_id' => TableMap::OPENING_ID_OFFSET_INCEPTION],
    ];

    public function __construct(private BaseConnection $db)
    {
    }

    /** @return list<array{table:string, column:string, sequence:string, max_id:int, before:int, after:int, next:int}> */
    public function resetAll(string $prefix = 'inv_', bool $dryRun = false): array
    {
        $rows = $this->db->query(
            "SELECT c.relname AS tbl, a.attname AS col, pg_get_serial_sequence(quote_ident(c.relname), a.attname) AS seq
             FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = current_schema() AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
               AND c.relname LIKE ? AND pg_get_serial_sequence(quote_ident(c.relname), a.attname) IS NOT NULL
             ORDER BY 1",
            [$prefix . '%']
        )->getResultArray();
        $out = [];
        foreach ($rows as $r) {
            $ceiling = self::ORGANIC_ID_CEILING[$r['tbl']][$r['col']] ?? null;
            $sql = 'SELECT COALESCE(MAX(' . $r['col'] . '),0) m FROM ' . $r['tbl'];
            $max = (int) ($this->db->query($ceiling !== null ? $sql . ' WHERE ' . $r['col'] . ' < ?' : $sql, $ceiling !== null ? [$ceiling] : [])->getRowArray()['m'] ?? 0);
            $cur = $this->db->query('SELECT last_value, is_called FROM ' . $r['seq'])->getRowArray();
            $before = (int) ($cur['last_value'] ?? 0);
            $target = max($max, 1);
            if (!$dryRun) {
                // setval(seq, max, true) => next value = max + 1 ; when the table is empty next = 1.
                $this->db->query('SELECT setval(?, ?, ?)', [$r['seq'], $target, $max > 0]);
            }
            $after = (int) ($this->db->query('SELECT last_value FROM ' . $r['seq'])->getRowArray()['last_value'] ?? 0);
            $out[] = ['table' => $r['tbl'], 'column' => $r['col'], 'sequence' => $r['seq'], 'max_id' => $max, 'before' => $before, 'after' => $after, 'next' => $max > 0 ? $max + 1 : 1];
        }

        return $out;
    }

    /**
     * Prove every sequence hands out an id above MAX by inserting-and-rolling-back a probe row.
     *
     * @return list<array{table:string, next_value:int, max_id:int, ok:bool}>
     */
    public function probe(string $prefix = 'inv_'): array
    {
        $out = [];
        foreach ($this->resetAll($prefix, true) as $s) {
            $this->db->transStart();
            $next = (int) $this->db->query('SELECT nextval(?) v', [$s['sequence']])->getRowArray()['v'];
            $this->db->transRollback();
            $this->db->resetTransStatus();
            // nextval is not transactional; put it back where it was so the probe leaves no gap.
            $this->db->query('SELECT setval(?, ?, ?)', [$s['sequence'], max($s['max_id'], 1), $s['max_id'] > 0]);
            $out[] = ['table' => $s['table'], 'next_value' => $next, 'max_id' => $s['max_id'], 'ok' => $next > $s['max_id']];
        }

        return $out;
    }
}
