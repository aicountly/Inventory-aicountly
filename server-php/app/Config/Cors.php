<?php

namespace Config;

use CodeIgniter\Config\BaseConfig;

class Cors extends BaseConfig
{
    public array $default = [
        'allowedOrigins' => [
            'http://localhost:5173',
            'http://localhost:8081',
            'https://ajcmqmc-dishas5911-8081.exp.direct',
            'http://192.168.31.120:8081',
            'https://erp.aicountly.com',
            'https://aicountly.github.io',
            'https://my.aicountly.com',
            'https://erp.aicountly.in',
            'https://sandbox.aicountly.com',
            'https://aicountly.com',
            'https://books.aicountly.com',
            'https://github.aicountly.com',
        ],

        'allowedHeaders' => [
            'Authorization',
            'Content-Type',
            'X-Requested-With',
            'Accept',
            'Cookie',
        ],

        'exposedHeaders' => [
            'Set-Cookie',
        ],

        'allowedMethods' => [
            'GET',
            'POST',
            'PUT',
            'DELETE',
            'OPTIONS',
        ],

        'supportsCredentials' => false,
    ];
}
