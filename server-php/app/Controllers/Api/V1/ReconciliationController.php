<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\ReconciliationService;

/**
 * /api/v1/reconciliation — Inventory closing valuation vs Books stock ledger balance.
 *
 *   GET  reconciliation                 runs for the company (fy-scoped unless all_fy=1)
 *   POST reconciliation/run             compute + persist a run {as_of}
 *   GET  reconciliation/{id}            one run with its breakdown and per-document status
 *   GET  reconciliation/posting-status  live composite posting status per Books-sourced document
 */
class ReconciliationController extends BaseController
{
    private const STATUSES = [ReconciliationService::STATUS_COMPLETED, ReconciliationService::STATUS_FAILED, ReconciliationService::STATUS_BOOKS_UNAVAILABLE];

    protected ReconciliationService $reconciliation;

    public function __construct()
    {
        parent::__construct();
        $this->reconciliation = new ReconciliationService();
    }

    /** GET /reconciliation?status=&from=&to=&all_fy=0|1 */
    public function index()
    {
        $a = $this->authorize('reconciliation.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $p = $this->listParams(50, 500, 'created_at');
        if (!$this->request->getGet('order')) {
            $p['order'] = 'DESC';
        }
        $b = \Config\Database::connect()->table('inv_reconciliation_runs')->where('cmp_id', (int) $ctx['cmp_id']);
        if ((int) ($this->request->getGet('all_fy') ?? 0) !== 1) {
            $b->where('fy_id', (int) $ctx['fy_id']);
        }
        if ((int) $ctx['bo_id'] > 0) {
            $b->where('bo_id', (int) $ctx['bo_id']);
        }
        $status = strtoupper(trim((string) ($this->request->getGet('status') ?? '')));
        if ($status !== '') {
            $statuses = array_values(array_intersect(explode(',', $status), self::STATUSES));
            if ($statuses === []) {
                return $this->failStructured(422, 'validation_failed', 'status must be one of ' . implode(', ', self::STATUSES), ['allowed' => self::STATUSES]);
            }
            $b->whereIn('status', $statuses);
        }
        if ($from = ReconciliationService::normalizeDate($this->request->getGet('from'))) {
            $b->where('as_of_date >=', $from);
        }
        if ($to = ReconciliationService::normalizeDate($this->request->getGet('to'))) {
            $b->where('as_of_date <=', $to);
        }
        $total = (clone $b)->countAllResults(false);
        $sort = in_array($p['sort'], ['created_at', 'as_of_date', 'run_id', 'difference', 'status', 'inventory_closing_value', 'books_stock_ledger_balance'], true) ? $p['sort'] : 'created_at';
        $rows = $b->select('run_id, run_uuid, cmp_id, fy_id, bo_id, as_of_date, inventory_closing_value, inventory_closing_qty, books_stock_ledger_balance, difference, status, requested_by, created_at')
            ->orderBy($sort, $p['order'])->orderBy('run_id', 'DESC')
            ->limit($p['limit'], $p['offset'])->get()->getResultArray();

        return $this->respondList(array_map(static fn ($r) => ReconciliationService::castRun($r), $rows), $total, $p['limit'], $p['offset']);
    }

    /** POST /reconciliation/run {as_of?: YYYY-MM-DD} */
    public function run()
    {
        $a = $this->authorizeAny(['reconciliation.resolve', 'reconciliation.read']);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $body = $this->parseOptionalRequestJson();
        $raw = trim((string) ($body['as_of'] ?? $this->request->getGet('as_of') ?? ''));
        $asOf = $raw === '' ? date('Y-m-d') : ReconciliationService::normalizeDate($raw);
        if ($asOf === null) {
            return $this->failStructured(422, 'validation_failed', 'as_of must be a date (YYYY-MM-DD)');
        }
        try {
            $run = $this->reconciliation->run((int) $ctx['cmp_id'], (int) $ctx['fy_id'], (int) $ctx['bo_id'], $asOf, $a['session']['uuid'] ?? null);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }

        return $this->respond(['data' => $run], 201);
    }

    /** GET /reconciliation/{id} */
    public function show($id = null)
    {
        $a = $this->authorize('reconciliation.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $run = $this->reconciliation->get((int) $a['ctx']['cmp_id'], (int) $id);
        if ($run === null) {
            return $this->failStructured(404, 'not_found', 'Reconciliation run not found');
        }

        return $this->respond(['data' => $run]);
    }

    /** GET /reconciliation/posting-status?sync_status=&source_document_type=&q= (paginated in memory) */
    public function postingStatus()
    {
        $a = $this->authorize('reconciliation.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $p = $this->listParams(100, 1000, 'document_date');
        try {
            $status = $this->reconciliation->postingStatus((int) $ctx['cmp_id'], (int) $ctx['fy_id'], (int) $ctx['bo_id']);
        } catch (\Throwable $e) {
            return $this->failFromException($e);
        }
        $entries = $status['entries'];
        $sync = strtoupper(trim((string) ($this->request->getGet('sync_status') ?? $this->request->getGet('status') ?? '')));
        if ($sync !== '') {
            $wanted = explode(',', $sync);
            $entries = array_values(array_filter($entries, static fn ($e) => in_array($e['sync_status'], $wanted, true)));
        }
        $srcType = trim((string) ($this->request->getGet('source_document_type') ?? ''));
        if ($srcType !== '') {
            $entries = array_values(array_filter($entries, static fn ($e) => strcasecmp((string) ($e['source']['source_document_type'] ?? ''), $srcType) === 0));
        }
        $docId = (int) ($this->request->getGet('source_document_id') ?? 0);
        if ($docId > 0) {
            $entries = array_values(array_filter($entries, static fn ($e) => (int) ($e['source']['source_document_id'] ?? 0) === $docId));
        }
        if ($p['order'] === 'DESC') {
            $entries = array_reverse($entries);
        }
        $total = count($entries);
        $page = array_slice($entries, $p['offset'], $p['limit']);

        return $this->respondList($page, $total, $p['limit'], $p['offset'], [
            'summary'         => $status['summary'],
            'books_available' => $status['books_available'],
            'books_error'     => $status['books_error'],
        ]);
    }
}
