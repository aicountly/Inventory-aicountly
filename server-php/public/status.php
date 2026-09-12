<?php
/**
 * Pre-boot health probe — verifies filesystem layout without loading CI4.
 * Used by cpanel-post-deploy-api.sh and deploy workflows.
 *
 * `?reset_opcache=1` also resets OPcache in the SAME process pool that serves
 * live traffic (PHP-FPM / mod_php / suPHP). This is the one thing the SSH
 * post-deploy step cannot do: `php -r 'opcache_reset();'` over SSH resets the
 * CLI SAPI's opcode cache, a separate memory arena from the web server's
 * worker pool. On hosts that run with opcache.validate_timestamps=0 (common
 * on shared/cPanel hosting — it avoids a filesystem stat() per include), an
 * rsync deploy updates the files on disk but the live workers keep serving
 * the old compiled bytecode until something calls opcache_reset() from
 * *inside* that same pool, or the workers themselves recycle. Every deploy
 * workflow curls this endpoint with the flag set, over HTTPS, so the reset
 * always runs on the process that actually answers requests.
 *
 * Not run on a bare hit (no monitoring/uptime ping should pay the
 * recompilation cost) — only when the flag is explicitly passed.
 */
header('Content-Type: application/json');

$root = dirname(__DIR__);
$checks = [
    'vendor_autoload' => is_file($root . '/vendor/autoload.php'),
    'ci4_boot'        => is_file($root . '/vendor/codeigniter4/framework/system/Boot.php'),
    'env_file'        => is_file($root . '/.env'),
    'writable'        => is_dir($root . '/writable') && is_writable($root . '/writable'),
    'public_index'    => is_file(__DIR__ . '/index.php'),
];

$ok = ! in_array(false, $checks, true);
http_response_code($ok ? 200 : 503);

$response = [
    'ok'     => $ok,
    'php'    => PHP_VERSION,
    'checks' => $checks,
];

if (($_GET['reset_opcache'] ?? '') === '1') {
    $available = function_exists('opcache_reset');
    $response['opcache'] = [
        'available' => $available,
        'reset'     => $available && opcache_reset(),
    ];
}

echo json_encode($response, JSON_UNESCAPED_SLASHES);
