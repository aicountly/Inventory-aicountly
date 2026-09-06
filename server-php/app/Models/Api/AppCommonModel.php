<?php

namespace App\Models\Api;

use App\Services\PortalAuthBaseResolver;
use CodeIgniter\Model;

class AppCommonModel extends Model
{
    /**
     * Validate a session key via my.aicountly.com (shared auth API for sandbox + production).
     * Returns user context on success, or ['status' => 0] on failure.
     */
    public function validateSesKey(string $sesKey): array
    {
        $portalBase = PortalAuthBaseResolver::resolveForRequest(service('request'));
        $ch = curl_init(rtrim($portalBase, '/') . '/api/validatesession');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_HTTPHEADER     => [
                'Authorization: Bearer ' . $sesKey,
                'Content-Type: application/json',
            ],
            CURLOPT_TIMEOUT        => 5,
        ]);
        $response = curl_exec($ch);
        curl_close($ch);

        if (!$response) {
            return ['status' => 0];
        }

        $data = json_decode($response, true);
        return is_array($data) ? $data : ['status' => 0];
    }
}
