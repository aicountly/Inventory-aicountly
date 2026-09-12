<?php

namespace Config;

use CodeIgniter\Database\Config;

/**
 * Database Configuration — PostgreSQL only (inv_* tables).
 */
class Database extends Config
{
    public string $filesPath = APPPATH . 'Database' . DIRECTORY_SEPARATOR;

    public string $defaultGroup = 'default';

    /** @var array<string, mixed> */
    public array $default = [
        'DSN'         => '',
        'hostname'    => '127.0.0.200',
        'username'    => '',
        'password'    => '',
        'database'    => '',
        'DBDriver'    => 'Postgre', // PostgreSQL only — never MySQL/SQLite for Inventory runtime
        'DBPrefix'    => '',
        'pConnect'    => false,
        'DBDebug'     => false,
        'charset'     => 'utf8',
        'DBCollat'    => '',
        'swapPre'     => '',
        'encrypt'     => false,
        'compress'    => false,
        'strictOn'    => false,
        'failover'    => [],
        'port'        => 5432,
        'schema'      => 'public',
        'foreignKeys' => true,
        'dateFormat'  => [
            'date'     => 'Y-m-d',
            'datetime' => 'Y-m-d H:i:s',
            'time'     => 'H:i:s',
        ],
    ];

    /**
     * PHPUnit database tests run against a real PostgreSQL database (the schema
     * uses JSONB, partial indexes and UUIDs, so SQLite cannot stand in for it).
     * Configure with INVENTORY_TEST_DB_* environment variables.
     *
     * @var array<string, mixed>
     */
    public array $tests = [
        'DSN'         => '',
        'hostname'    => '127.0.0.1',
        'username'    => 'inventory_rehearsal',
        'password'    => 'inventory_rehearsal',
        'database'    => 'inventory_test',
        'DBDriver'    => 'Postgre',
        'DBPrefix'    => '',
        'pConnect'    => false,
        'DBDebug'     => true,
        'charset'     => 'utf8',
        'DBCollat'    => '',
        'swapPre'     => '',
        'encrypt'     => false,
        'compress'    => false,
        'strictOn'    => false,
        'failover'    => [],
        'port'        => 5432,
        'schema'      => 'public',
        'foreignKeys' => true,
        'dateFormat'  => [
            'date'     => 'Y-m-d',
            'datetime' => 'Y-m-d H:i:s',
            'time'     => 'H:i:s',
        ],
    ];

    public function __construct()
    {
        parent::__construct();

        foreach (['hostname' => 'INVENTORY_TEST_DB_HOST', 'username' => 'INVENTORY_TEST_DB_USER', 'password' => 'INVENTORY_TEST_DB_PASSWORD', 'database' => 'INVENTORY_TEST_DB_NAME', 'port' => 'INVENTORY_TEST_DB_PORT'] as $key => $env) {
            $value = getenv($env);
            if ($value !== false && $value !== '') {
                $this->tests[$key] = $key === 'port' ? (int) $value : $value;
            }
        }

        if (ENVIRONMENT === 'testing') {
            $this->defaultGroup = 'tests';
        }
    }
}
