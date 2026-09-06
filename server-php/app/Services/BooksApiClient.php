<?php

namespace App\Services;

/**
 * Server-to-server calls from Inventory to Books (integration endpoints), authenticated with
 * the shared BOOKS_SERVICE_KEY. Books validates the key and the company the event belongs to.
 */
class BooksApiClient
{
    private const HOST_MAP = [
        'inventory.aicountly.com'    => 'https://books.aicountly.com',
        'inventory.gh.aicountly.com' => 'https://books.gh.aicountly.com',
        'gh-inventory.aicountly.com' => 'https://books.gh.aicountly.com',
    ];

    public function base(): string
    {
        $env = getenv('BOOKS_API_BASE');
        if ($env !== false && trim($env) !== '') {
            return rtrim(trim($env), '/');
        }
        $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
        $host = explode(':', preg_replace('/^www\./', '', $host))[0];
        if (isset(self::HOST_MAP[$host])) {
            return self::HOST_MAP[$host];
        }
        if (preg_match('/\.gh\.aicountly\.com$/', $host) || str_starts_with($host, 'gh-')) {
            return 'https://books.gh.aicountly.com';
        }

        return 'https://books.aicountly.com';
    }

    /** @return array{ok:bool, status:int, body:?array, error:?string} */
    public function postEvent(array $envelope): array
    {
        return $this->request('POST', 'integration/inventory/events', $envelope);
    }

    /** @return array{ok:bool, status:int, body:?array, error:?string} */
    public function stockLedgerBalance(int $cmpId, int $fyId, int $boId, string $asOf): array
    {
        return $this->request('GET', 'integration/inventory/stock-ledger-balance?cmp_id=' . $cmpId . '&fy_id=' . $fyId . '&bo_id=' . $boId . '&as_of=' . rawurlencode($asOf));
    }

    /** @return array{ok:bool, status:int, body:?array, error:?string} */
    public function postingStatus(int $cmpId, int $fyId): array
    {
        return $this->request('GET', 'integration/inventory/posting-status?cmp_id=' . $cmpId . '&fy_id=' . $fyId);
    }

    /** @return array{ok:bool, status:int, body:?array, error:?string} */
    public function request(string $method, string $path, ?array $body = null): array
    {
        $key = (string) (getenv('BOOKS_SERVICE_KEY') ?: '');
        if ($key === '' || str_starts_with($key, 'CHANGE_ME')) {
            return ['ok' => false, 'status' => 0, 'body' => null, 'error' => 'BOOKS_SERVICE_KEY not configured'];
        }
        $url = $this->base() . '/api/' . ltrim($path, '/');
        $ch = curl_init($url);
        $headers = ['Accept: application/json', 'Content-Type: application/json', 'X-Service-Key: ' . $key, 'X-Source-App: inventory'];
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => strtoupper($method),
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT        => 30,
        ];
        if ($body !== null) {
            $opts[CURLOPT_POSTFIELDS] = json_encode($body, JSON_UNESCAPED_UNICODE);
        }
        curl_setopt_array($ch, $opts);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($raw === false || $status === 0) {
            return ['ok' => false, 'status' => 0, 'body' => null, 'error' => $err ?: 'Books unreachable'];
        }
        $decoded = json_decode((string) $raw, true);

        return [
            'ok'     => $status >= 200 && $status < 300,
            'status' => $status,
            'body'   => is_array($decoded) ? $decoded : null,
            'error'  => $status >= 300 ? ('Books HTTP ' . $status . ': ' . substr((string) $raw, 0, 500)) : null,
        ];
    }
}
