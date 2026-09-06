<?php
 
namespace App\Filters;
 
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;
use CodeIgniter\Filters\FilterInterface;
 
class CorsFilter implements FilterInterface
{
    public function before(RequestInterface $request, $arguments = null)
    {
        $origin = $request->getHeaderLine('Origin');
 
        $allowedOrigins = [
            'http://localhost:5173',
            'https://my.aicountly.com',
            'https://sandbox.aicountly.com',
            'https://inventory.aicountly.com',
            'https://inventory.gh.aicountly.com',
            'https://books.aicountly.com',
            'https://books.gh.aicountly.com',
            'https://sales.aicountly.com',
            'https://purchases.aicountly.com',
            'https://pos.aicountly.com',
            'https://billing.aicountly.com',
            'https://aicountly.github.io',
        ];
 
        if (in_array($origin, $allowedOrigins, true) || self::isGhSandboxOrigin($origin)) {
            header("Access-Control-Allow-Origin: $origin");
        }
 
        header("Vary: Origin");
        header("Access-Control-Allow-Headers: Authorization, Content-Type, X-Requested-With, Accept, X-Origin-Host, X-Books-Origin-Host, X-Company-Acs-Type, X-Request-Id, X-Correlation-Id, Idempotency-Key, X-Service-Key, X-Actor-Uuid, X-Source-App");
        header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
        header("Access-Control-Expose-Headers: Set-Cookie, X-Request-Id");
 
        if ($request->getMethod() === 'options') {
            http_response_code(204);
            exit;
        }
    }
 
    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
        try {
            $requestId = \App\Services\ClientRequestContext::requestId();
            if ($requestId) {
                $response->setHeader('X-Request-Id', $requestId);
            }
        } catch (\Throwable $e) {
            // best-effort correlation header
        }

        return $response;
    }

    private static function isGhSandboxOrigin(string $origin): bool
    {
        $host = parse_url($origin, PHP_URL_HOST);
        if (!is_string($host) || $host === '') {
            return false;
        }
        $host = strtolower($host);

        return preg_match('/^[a-z0-9-]+\.gh\.aicountly\.com$/', $host) === 1
            || preg_match('/^gh-[a-z0-9-]+\.aicountly\.com$/', $host) === 1;
    }
}