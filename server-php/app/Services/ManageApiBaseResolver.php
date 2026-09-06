<?php

namespace App\Services;

use CodeIgniter\HTTP\RequestInterface;

/**
 * Maps Inventory (or calling product) host → Manage API origin.
 */
class ManageApiBaseResolver
{
    private const HOST_MAP = [
        'inventory.aicountly.com'    => 'https://manage.aicountly.com',
        'inventory.gh.aicountly.com' => 'https://manage.gh.aicountly.com',
        'gh-inventory.aicountly.com' => 'https://manage.gh.aicountly.com',
        'books.aicountly.com'        => 'https://manage.aicountly.com',
        'books.gh.aicountly.com'     => 'https://manage.gh.aicountly.com',
    ];

    public static function resolve(?string $httpHost = null): string
    {
        $host = self::normalizeHost($httpHost ?? $_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? '');

        return self::resolveForHost($host);
    }

    public static function resolveForRequest(RequestInterface $request): string
    {
        $browserHost = trim($request->getHeaderLine('X-Origin-Host'));
        if ($browserHost === '') {
            $browserHost = self::hostFromUrlHeader($request->getHeaderLine('Origin'))
                ?: self::hostFromUrlHeader($request->getHeaderLine('Referer'));
        }

        return self::resolveFromBrowserHost(
            $browserHost,
            trim($request->getHeaderLine('X-Forwarded-Host')),
            null
        );
    }

    private static function hostFromUrlHeader(string $value): string
    {
        $value = trim($value);
        if ($value === '') {
            return '';
        }

        $host = parse_url($value, PHP_URL_HOST);

        return is_string($host) ? self::normalizeHost($host) : '';
    }

    public static function resolveFromBrowserHost(
        ?string $browserHost = null,
        ?string $forwardedHost = null,
        ?string $serverHost = null
    ): string {
        if ($browserHost !== null && $browserHost !== '') {
            return self::resolveForHost(self::normalizeHost($browserHost));
        }

        if ($forwardedHost !== null && $forwardedHost !== '') {
            $forwardedHost = trim(explode(',', $forwardedHost)[0]);

            return self::resolveForHost(self::normalizeHost($forwardedHost));
        }

        return self::resolve($serverHost);
    }

    private static function resolveForHost(string $host): string
    {
        if (isset(self::HOST_MAP[$host])) {
            return self::HOST_MAP[$host];
        }

        if (self::isSandboxHost($host)) {
            return 'https://manage.gh.aicountly.com';
        }

        $envBase = getenv('MANAGE_API_BASE');
        if ($envBase !== false && $envBase !== '') {
            return rtrim((string) $envBase, '/');
        }

        return 'https://manage.aicountly.com';
    }

    private static function isSandboxHost(string $host): bool
    {
        if ($host === 'localhost' || str_starts_with($host, '127.')) {
            return true;
        }
        if (preg_match('/^[a-z0-9-]+\.gh\.aicountly\.com$/', $host) === 1) {
            return true;
        }
        if (preg_match('/^gh-[a-z0-9-]+\.aicountly\.com$/', $host) === 1) {
            return true;
        }

        return false;
    }

    private static function normalizeHost(string $host): string
    {
        $host = preg_replace('/^www\./i', '', trim($host));
        $host = explode(':', $host)[0];

        return $host;
    }
}
