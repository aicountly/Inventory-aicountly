<?php

namespace App\Services;

/**
 * Request-scoped client context for audit trails (IP, request id, user agent).
 * Generated once per HTTP request so every audit write shares the same correlation id.
 */
class ClientRequestContext
{
    private static ?string $requestId = null;

    public static function requestId(): ?string
    {
        if (self::$requestId !== null) {
            return self::$requestId;
        }

        try {
            if (function_exists('is_cli') && is_cli()) {
                throw new \RuntimeException('cli');
            }
            $req = service('request');
            $header = trim((string) $req->getHeaderLine('X-Request-Id'));
            if ($header === '') {
                $header = trim((string) $req->getHeaderLine('X-Correlation-Id'));
            }
            if ($header !== '') {
                self::$requestId = substr($header, 0, 64);

                return self::$requestId;
            }
        } catch (\Throwable $e) {
            // fall through to generated id
        }

        try {
            self::$requestId = substr(bin2hex(random_bytes(16)), 0, 32);
        } catch (\Throwable $e) {
            self::$requestId = substr(str_replace('.', '', uniqid('req', true)), 0, 32);
        }

        return self::$requestId;
    }

    public static function ipAddress(): ?string
    {
        try {
            if (function_exists('is_cli') && is_cli()) {
                return null;
            }
            $req = service('request');
            $candidates = [];

            // Prefer framework resolution (honours Config\App::$proxyIPs when set).
            $resolved = trim((string) $req->getIPAddress());
            if ($resolved !== '' && $resolved !== '0.0.0.0') {
                $candidates[] = $resolved;
            }

            // Fallback headers commonly set by reverse proxies / CDNs when proxyIPs is empty.
            foreach (['CF-Connecting-IP', 'True-Client-IP', 'X-Real-IP'] as $header) {
                $value = trim((string) $req->getHeaderLine($header));
                if ($value !== '') {
                    $candidates[] = $value;
                }
            }
            $forwarded = trim((string) $req->getHeaderLine('X-Forwarded-For'));
            if ($forwarded !== '') {
                $first = trim(explode(',', $forwarded)[0] ?? '');
                if ($first !== '') {
                    $candidates[] = $first;
                }
            }

            foreach ($candidates as $ip) {
                $ip = substr($ip, 0, 64);
                if (filter_var($ip, FILTER_VALIDATE_IP)) {
                    return $ip;
                }
            }
        } catch (\Throwable $e) {
            return null;
        }

        return null;
    }

    public static function userAgent(): ?string
    {
        try {
            $req = service('request');
            $ua = $req->getUserAgent();
            if (is_object($ua) && method_exists($ua, 'getAgentString')) {
                $str = trim((string) $ua->getAgentString());
                if ($str !== '') {
                    return substr($str, 0, 512);
                }
            }
            $header = trim((string) $req->getHeaderLine('User-Agent'));

            return $header !== '' ? substr($header, 0, 512) : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Compact client block stored in meta_json so Event detail always has a fallback
     * even when dedicated columns are missing on older schemas.
     *
     * @return array{ip: ?string, request_id: ?string, user_agent: ?string}
     */
    public static function clientMeta(): array
    {
        return [
            'ip' => self::ipAddress(),
            'request_id' => self::requestId(),
            'user_agent' => self::userAgent(),
        ];
    }

    /** @internal test helper */
    public static function resetForTests(): void
    {
        self::$requestId = null;
    }
}
