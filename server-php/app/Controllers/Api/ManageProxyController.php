<?php

namespace App\Controllers\Api;

use App\Services\ManageApiBaseResolver;
use CodeIgniter\API\ResponseTrait;
use CodeIgniter\RESTful\ResourceController;

/**
 * Forwards /api/manage/* to the Manage product API (companies, branches, financial years)
 * so the SPA stays same-origin. Read-only paths only.
 */
class ManageProxyController extends ResourceController
{
    use ResponseTrait;

    private const ALLOWED_PREFIXES = ['companies', 'companyinfo', 'branch/list', 'branch/info', 'fy', 'user/logo', 'company/logo', 'apps'];

    public function proxy(string $path = '')
    {
        $path = trim($path, '/');
        $ok = false;
        foreach (self::ALLOWED_PREFIXES as $p) {
            if ($path === $p || str_starts_with($path, $p . '/') || str_starts_with($path, $p . '?')) {
                $ok = true;
                break;
            }
        }
        if (!$ok || strtoupper($this->request->getMethod()) !== 'GET') {
            return $this->failNotFound('Not relayed');
        }
        $base = rtrim(ManageApiBaseResolver::resolveForRequest($this->request), '/');
        $query = $this->request->getUri()->getQuery();
        $url = $base . '/api/' . $path . ($query !== '' ? '?' . $query : '');
        $headers = [];
        $auth = $this->request->getHeaderLine('Authorization');
        if ($auth !== '') {
            $headers['Authorization'] = $auth;
        }
        $client = single_service('curlrequest', ['http_errors' => false, 'connect_timeout' => 8, 'timeout' => 15]);
        try {
            $res = $client->request('GET', $url, ['headers' => $headers]);
        } catch (\Throwable) {
            return $this->respond(['message' => 'Company service unavailable — please retry'], 504);
        }

        return $this->response->setStatusCode($res->getStatusCode())
            ->setContentType($res->getHeaderLine('Content-Type') ?: 'application/json')
            ->setBody($res->getBody());
    }
}
