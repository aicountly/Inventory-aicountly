<?php

namespace App\Controllers\Api\V1;

use App\Controllers\Api\BaseController;
use App\Services\BooksBulkTaxUpdateService;

/**
 * /api/v1/operations/bulk-tax-update — Items → Bulk Tax Rate Update, proxied to Books.
 *
 * Inventory has no tax rate of its own to bulk-edit (see BooksBulkTaxUpdateService's docblock),
 * so every action here is a thin, permission-gated relay onto Books' own Operations → Bulk
 * Update engine (target `item_tax_category`), using the operator's own Books session.
 *
 *   GET  operations/bulk-tax-update/records    paginated, filterable item grid
 *   POST operations/bulk-tax-update/validate   validate a batch, write nothing
 *   POST operations/bulk-tax-update/apply      re-validate then write atomically
 */
class BulkTaxUpdateController extends BaseController
{
    private ?BooksBulkTaxUpdateService $books = null;

    public function __construct()
    {
        parent::__construct();
    }

    private function books(): BooksBulkTaxUpdateService
    {
        return $this->books ??= new BooksBulkTaxUpdateService();
    }

    /**
     * Books speaks page / per_page; every other Inventory list endpoint speaks limit / offset
     * (`BaseController::listParams()`, and `api.list()` on the frontend). Translating here, once,
     * keeps that one difference from leaking into either the service or the frontend, and the
     * response is reshaped the same way — Books' {data, total, target} becomes Inventory's own
     * {data, meta: {total, limit, offset}} — so this endpoint reads like every other list here.
     */
    public function records()
    {
        $a = $this->authorize('masters.items.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }

        $list = $this->listParams(25, 500);
        $query = array_merge($this->request->getGet() ?? [], [
            'page'     => (string) (intdiv($list['offset'], max(1, $list['limit'])) + 1),
            'per_page' => (string) $list['limit'],
        ]);

        $res = $this->books()->records($a['ctx'], $this->booksBearer($a['session']), $query);
        if (!$res['ok']) {
            return $this->relayError($res);
        }

        $rows = is_array($res['body']['data'] ?? null) ? $res['body']['data'] : [];
        $total = (int) ($res['body']['total'] ?? count($rows));

        return $this->respondList($rows, $total, $list['limit'], $list['offset']);
    }

    /**
     * Not named validate(): CodeIgniter\Controller already declares
     * `validate($rules, array $messages = [])`, and redeclaring it with a different signature
     * is a compile-time fatal that kills every route on this controller, not just this one.
     */
    public function validateBatch()
    {
        $a = $this->authorize('masters.items.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $body = $this->request->getJSON(true);

        return $this->relay($this->books()->validate($a['ctx'], $this->booksBearer($a['session']), is_array($body) ? $body : []));
    }

    /** Tax category options for the filter and the new-value picker — see the service docblock. */
    public function taxCategories()
    {
        $a = $this->authorize('masters.items.read', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }

        return $this->relay($this->books()->taxCategories($a['ctx'], $this->booksBearer($a['session'])));
    }

    public function apply()
    {
        $a = $this->authorize('masters.items.write', true, false);
        if (isset($a['response'])) {
            return $a['response'];
        }
        $body = $this->request->getJSON(true);

        return $this->relay($this->books()->apply($a['ctx'], $this->booksBearer($a['session']), is_array($body) ? $body : []));
    }

    /**
     * The ses_key Inventory just validated on this very request — not re-parsed from the header,
     * since `auth()` already did that and this must be the identical token Books re-validates.
     *
     * @param array<string, mixed> $session
     */
    private function booksBearer(array $session): string
    {
        return (string) ($session['ses_key'] ?? '');
    }

    /**
     * A success answer is relayed verbatim — a validate/apply body is already `{data: {...}}`,
     * which is exactly Inventory's own single-resource shape, so nothing here needs reshaping.
     *
     * @param array{ok:bool, status:int, body:?array, error:?string} $res
     */
    private function relay(array $res)
    {
        if (!$res['ok']) {
            return $this->relayError($res);
        }

        return $this->respond($res['body'], $res['status'] ?: 200);
    }

    /**
     * Books' failure, reshaped into Inventory's own `{error: {code, message, details}, message}`
     * envelope — the frontend's ApiError only ever reads a message from `error.message` /
     * `message` and structured extra data from `error.details`, so a 422's per-row validation
     * payload (`{messages: {error}, data: {rows, summary}}` on Books) has to move into
     * `details` here or it is silently dropped on the way to the review screen. Books being
     * unreachable at all (no parseable body) gets its own code rather than being reported as
     * whatever Books' last HTTP status happened to be.
     *
     * @param array{ok:bool, status:int, body:?array, error:?string} $res
     */
    private function relayError(array $res)
    {
        if ($res['body'] === null) {
            return $this->failStructured($res['status'] > 0 ? $res['status'] : 502, 'books_unreachable', $res['error'] ?? 'Books is unreachable');
        }

        $status = $res['status'] ?: 502;
        $body = $res['body'];
        $messages = is_array($body['messages'] ?? null) ? $body['messages'] : [];
        $message = (string) ($body['message'] ?? $messages['error'] ?? 'Books refused the request');
        $details = is_array($body['data'] ?? null) ? $body['data'] : null;
        $code = match (true) {
            $status === 401 => 'unauthorized',
            $status === 403 => 'forbidden',
            $status === 410 => 'books_owned_field',
            $status === 422 => 'validation_failed',
            default => 'books_error',
        };

        return $this->failStructured($status, $code, $message, $details);
    }
}
