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
            $max = (int) ($this->db->query('SELECT COALESCE(MAX(' . $r['col'] . '),0) m FROM ' . $r['tbl'])->getRowArray()['m'] ?? 0);
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
