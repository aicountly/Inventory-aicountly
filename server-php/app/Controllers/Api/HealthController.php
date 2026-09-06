<?php

namespace App\Controllers\Api;

use CodeIgniter\API\ResponseTrait;
use CodeIgniter\RESTful\ResourceController;

class HealthController extends ResourceController
{
    use ResponseTrait;

    public function index()
    {
        $dbOk = false;
        try {
            $db = \Config\Database::connect();
            $db->query('SELECT 1');
            $dbOk = true;
        } catch (\Throwable) {
        }

        return $this->respond([
            'status' => $dbOk ? 'ok' : 'degraded',
            'app'    => 'Inventory',
            'env'    => ENVIRONMENT,
            'db'     => $dbOk,
            'time'   => gmdate('c'),
        ], $dbOk ? 200 : 503);
    }

    public function revision()
    {
        $file = ROOTPATH . 'REVISION';
        $rev = is_file($file) ? trim((string) file_get_contents($file)) : null;

        return $this->respond(['revision' => $rev, 'php' => PHP_VERSION]);
    }
}
