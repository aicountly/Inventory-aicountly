<?php

namespace App\Controllers\Api;

use App\Services\PortalAuthBaseResolver;
use CodeIgniter\API\ResponseTrait;
use CodeIgniter\RESTful\ResourceController;

/**
 * Same-origin relay for the portal session bootstrap (seskey, refresh, validatesession, logout).
 * Allow-listed on purpose: this host must never become an open proxy for the portal.
 */
class GlobalAuthProxyController extends ResourceController
{
    use ResponseTrait;

    private const RELAYED = ['seskey', 'seskey/refresh', 'refresh_authtoken', 'validatesession', 'logout', 'userprofile'];

    public function proxy(string $path = '')
    {
        $path = strtolower(trim(rawurldecode($path), '/'));
        if (!in_array($path, self::RELAYED, true)) {
            return $this->failNotFound('This path is not relayed');
        }
        $base = rtrim(PortalAuthBaseResolver::resolveForRequest($this->request), '/');
        $headers = [];
        foreach (['Authorization', 'Content-Type'] as $h) {
            $v = $this->request->getHeaderLine($h);
            if ($v !== '') {
                $headers[$h] = $v;
            }
        }
        $client = single_service('curlrequest', ['http_errors' => false, 'connect_timeout' => 8, 'timeout' => 15]);
        $method = strtoupper($this->request->getMethod());
        $options = ['headers' => $headers];
        $body = (string) $this->request->getBody();
        if ($body !== '' && in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
            $options['body'] = $body;
        }
        try {
            $res = $client->request($method, $base . '/api/' . $path, $options);
        } catch (\Throwable) {
            return $this->respond(['message' => 'Auth service unavailable — please retry'], 504);
        }

        return $this->response->setStatusCode($res->getStatusCode())
            ->setContentType($res->getHeaderLine('Content-Type') ?: 'application/json')
            ->setBody($res->getBody());
    }
}
