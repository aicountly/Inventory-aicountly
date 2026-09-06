<?php
/* 
 *---------------------------------------------------------------
 * CHECK PHP VERSION
 *---------------------------------------------------------------
 */

$minPhpVersion = '8.1';

if (version_compare(PHP_VERSION, $minPhpVersion, '<')) {
    die(
        sprintf(
            'Your PHP version must be %s or higher to run CodeIgniter. Current version: %s',
            $minPhpVersion,
            PHP_VERSION
        )
    );
}

/*
 *---------------------------------------------------------------
 * SET ENVIRONMENT
 *---------------------------------------------------------------
 * Ensure CI_ENVIRONMENT is always defined before CI4 boots.
 * The .htaccess SetEnv is the primary source; this is the fallback
 * for CLI or environments where .htaccess SetEnv is not available.
 * Also force-set into $_SERVER, $_ENV, and putenv so CI4's Boot
 * can read it regardless of php.ini variables_order (GPCS = no E).
 */
$ciEnv = $_SERVER['CI_ENVIRONMENT'] ?? getenv('CI_ENVIRONMENT') ?: 'production';
$_SERVER['CI_ENVIRONMENT'] = $ciEnv;
$_ENV['CI_ENVIRONMENT']    = $ciEnv;
putenv('CI_ENVIRONMENT=' . $ciEnv);

if (! defined('ENVIRONMENT')) {
    define('ENVIRONMENT', $ciEnv);
}

/*
 *---------------------------------------------------------------
 * DEFINE APPLICATION PATHS
 *---------------------------------------------------------------
 */

define('FCPATH', __DIR__ . DIRECTORY_SEPARATOR);

if (getcwd() . DIRECTORY_SEPARATOR !== FCPATH) {
    chdir(FCPATH);
}

/*
 *---------------------------------------------------------------
 * LOAD PATHS CONFIG
 *---------------------------------------------------------------
 */

require FCPATH . '../app/Config/Paths.php';

$paths = new Config\Paths();

/*
 *---------------------------------------------------------------
 * LOAD BOOTSTRAP
 *---------------------------------------------------------------
 */

require rtrim($paths->systemDirectory, '\\/ ') . DIRECTORY_SEPARATOR . 'Boot.php';

try {
    exit(CodeIgniter\Boot::bootWeb($paths));
} catch (\Throwable $e) {
    $logDir = dirname(__DIR__) . '/writable/logs';
    if (is_dir($logDir) && is_writable($logDir)) {
        @file_put_contents(
            $logDir . '/boot-' . date('Y-m-d') . '.log',
            date('c') . ' ' . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n",
            FILE_APPEND
        );
    }
    http_response_code(500);
    exit(1);
}
