<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\JobWorkSummaryService;

/**
 * Job work.
 *
 *   GET /api/v1/job-work/summary   the position above the inward / outward entry screens
 *
 * There is no list endpoint here and no second create / post route: a job-work
 * dispatch and receipt are ordinary inventory documents
 * (/v1/inventory-documents, types JOB_WORK_OUT and JOB_WORK_IN) and the open
 * position is the pending register (/v1/pending-quantities?kind=job_work).
 * Both already carry every rule — numbering, valuation, negative stock, period
 * locks, settlement — so a parallel door into them could only be a second,
 * weaker copy of those rules.
 *
 * What was missing was the aggregate: how much is out, how much is late, what
 * came back this month and what the round trip costs in days. That is one read,
 * and it is what this controller answers.
 */
class JobWorkController extends BaseController
{
    /**
     * GET /api/v1/job-work/summary
     *
     * Company, financial year and branch come from the authorised session
     * context, never from a query parameter. "As on" is the server's own day,
     * pulled back to the selected year's close when that year has already
     * ended, so a reader browsing a closed year is not told the shop floor
     * looks like this morning.
     *
     * The screen never depends on this call: a failure here leaves the KPI
     * cards showing an em dash and every field, line and posting path intact.
     */
    public function summary()
    {
        $a = $this->authorize('documents.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];

        try {
            $data = (new JobWorkSummaryService())->summary(
                (int) $ctx['cmp_id'],
                (int) $ctx['fy_id'],
                (int) $ctx['bo_id'],
                date('Y-m-d'),
            );
        } catch (\Throwable $e) {
            log_message('error', 'job work summary failed: ' . $e->getMessage());

            return $this->failStructured(500, 'query_failed', 'Could not read the job-work position for this company');
        }

        return $this->respond(['data' => $data]);
    }

    /**
     * GET /api/v1/job-work/workers?q=
     *
     * The job workers this company has sent material to, for the selector on
     * the entry form. Inventory's own documents answer it — the ledger master
     * stays Books', and the link beside the field opens it there.
     */
    public function workers()
    {
        $a = $this->authorize('documents.read');
        if (isset($a['response'])) {
            return $a['response'];
        }
        $ctx = $a['ctx'];
        $limit = (int) $this->request->getGet('limit') ?: 20;

        try {
            $rows = (new JobWorkSummaryService())->workers(
                (int) $ctx['cmp_id'],
                (int) $ctx['bo_id'],
                (string) ($this->request->getGet('q') ?? ''),
                $limit,
            );
        } catch (\Throwable $e) {
            log_message('error', 'job work workers failed: ' . $e->getMessage());

            return $this->failStructured(500, 'query_failed', 'Could not read the job workers for this company');
        }

        return $this->respondList($rows, count($rows), max(1, min($limit, 50)), 0);
    }
}
