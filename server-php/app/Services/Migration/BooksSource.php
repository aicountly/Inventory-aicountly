<?php

namespace App\Services\Migration;

use CodeIgniter\Database\BaseConnection;
use CodeIgniter\Database\Config as Db;

/**
 * Read-only connection to the Books PostgreSQL database (migration source).
 *
 * Configured with BOOKS_DB_* environment variables (never the Inventory .env database.*):
 *   BOOKS_DB_HOST, BOOKS_DB_PORT, BOOKS_DB_NAME, BOOKS_DB_USER, BOOKS_DB_PASSWORD, BOOKS_DB_SCHEMA
 * The migration only ever SELECTs from Books; the cutover runbook makes Books read-only by policy.
 */
class BooksSource
{
    private static ?BaseConnection $db = null;

    public static function connection(): BaseConnection
    {
        if (self::$db !== null) {
            return self::$db;
        }
        $cfg = [
            'DSN'         => '',
            'hostname'    => (string) (getenv('BOOKS_DB_HOST') ?: '127.0.0.1'),
            'username'    => (string) (getenv('BOOKS_DB_USER') ?: ''),
            'password'    => (string) (getenv('BOOKS_DB_PASSWORD') ?: ''),
            'database'    => (string) (getenv('BOOKS_DB_NAME') ?: ''),
            'DBDriver'    => 'Postgre',
            'DBPrefix'    => '',
            'pConnect'    => false,
            'DBDebug'     => true,
            'charset'     => 'utf8',
            'port'        => (int) (getenv('BOOKS_DB_PORT') ?: 5432),
            'schema'      => (string) (getenv('BOOKS_DB_SCHEMA') ?: 'public'),
            'foreignKeys' => true,
        ];
        if ($cfg['database'] === '' || $cfg['username'] === '') {
            throw new \RuntimeException('BOOKS_DB_NAME / BOOKS_DB_USER (and BOOKS_DB_HOST/PASSWORD) must be set to reach the Books database');
        }
        self::$db = Db::connect($cfg, false);
        self::$db->initialize();
        // Belt and braces: this session never writes to Books.
        self::$db->query('SET default_transaction_read_only = on');

        return self::$db;
    }

    public static function reset(): void
    {
        self::$db = null;
    }
}
