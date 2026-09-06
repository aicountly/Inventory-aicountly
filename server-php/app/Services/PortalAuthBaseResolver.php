<?php

namespace App\Services;

use CodeIgniter\HTTP\RequestInterface;

/**
 * Resolves the portal auth API origin (seskey, validatesession, userprofile, logout).
 *
 * Always my.aicountly.com for every Books host — sandbox and production share the same
 * auth API. Login redirect uses sandbox.aicountly.com separately (web hostnameUtils only).
 */
class PortalAuthBaseResolver
{
    private const DEFAULT_AUTH_BASE = 'https://my.aicountly.com';

    public static function resolve(?string $httpHost = null): string
    {
        return self::resolveAuthBase();
    }

    public static function resolveForRequest(RequestInterface $request): string
    {
        return self::resolveAuthBase();
    }

    public static function resolveFromBrowserHost(
        ?string $browserHost = null,
        ?string $forwardedHost = null,
        ?string $serverHost = null
    ): string {
        return self::resolveAuthBase();
    }

    private static function resolveAuthBase(): string
    {
        $envBase = getenv('PORTAL_AUTH_BASE');
        if ($envBase !== false && $envBase !== '') {
            return rtrim((string) $envBase, '/');
        }

        return self::DEFAULT_AUTH_BASE;
    }
}
