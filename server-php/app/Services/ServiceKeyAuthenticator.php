<?php

namespace App\Services;

/**
 * Resolves a trusted product backend from X-Service-Key.
 *
 * INVENTORY_SERVICE_KEYS = "books:key1,sales:key2". Comparison is constant-time.
 */
class ServiceKeyAuthenticator
{
    /** @return array<string, string> app => key */
    public function configuredKeys(): array
    {
        $raw = (string) (getenv('INVENTORY_SERVICE_KEYS') ?: '');
        $out = [];
        foreach (explode(',', $raw) as $pair) {
            $pair = trim($pair);
            if ($pair === '' || !str_contains($pair, ':')) {
                continue;
            }
            [$app, $key] = explode(':', $pair, 2);
            $app = strtolower(trim($app));
            $key = trim($key);
            if ($app !== '' && $key !== '' && !str_starts_with($key, 'CHANGE_ME')) {
                $out[$app] = $key;
            }
        }

        return $out;
    }

    public function resolveApp(string $presented): ?string
    {
        $presented = trim($presented);
        if ($presented === '' || strlen($presented) < 16) {
            return null;
        }
        foreach ($this->configuredKeys() as $app => $key) {
            if (hash_equals($key, $presented)) {
                return $app;
            }
        }

        return null;
    }
}
