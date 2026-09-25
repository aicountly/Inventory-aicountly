<?php

namespace Tests\Support;

use App\Services\CronHeartbeat;

/**
 * A CronHeartbeat that records what it would have sent, and can be told to behave like a Console
 * that is down, slow, angry or simply absent.
 *
 * Here rather than inside one test file because both the library's own tests and the proving
 * client's tests need it, and a stand-in for the transport is the only honest way to assert the
 * rule that matters: that none of those faults can reach the job.
 */
class SpyCronHeartbeat extends CronHeartbeat
{
    /** Handed to the next static::for(), so reportRun() can be observed. */
    public static ?self $next = null;

    /** @var list<array{url:string, body:string, payload:array<string, mixed>}> */
    public array $posts = [];

    /** @var list<string> */
    public array $warnings = [];

    /** Thrown from the transport on every call: a DNS failure, a refused connection, a missing ext-curl. */
    public ?\Throwable $throw = null;

    /** @var array{status:int, body:string, error:string} what Console answers */
    public array $response = ['status' => 200, 'body' => '{"success":true}', 'error' => ''];

    /** @var null|callable(array<string, mixed>):void observes the order reports are filed in */
    public $onPost = null;

    /** True once begin() would have armed the real fatal-error guard. */
    public bool $fatalGuardArmed = false;

    public static function for(string $monitor): static
    {
        if (static::$next !== null) {
            $beat           = static::$next;
            static::$next = null;

            return $beat;
        }

        return new static($monitor);
    }

    protected function post(string $url, string $body): array
    {
        if ($this->throw !== null) {
            throw $this->throw;
        }
        $payload       = json_decode($body, true) ?? [];
        $this->posts[] = ['url' => $url, 'body' => $body, 'payload' => $payload];
        if ($this->onPost !== null) {
            ($this->onPost)($payload);
        }

        return $this->response;
    }

    protected function warn(\Throwable $e): void
    {
        $this->warnings[] = $e->getMessage();
    }

    /**
     * Records that begin() would have armed the guard, without registering a real shutdown
     * function against the PHPUnit process — see CronHeartbeat::armFatalErrorGuard().
     */
    protected function armFatalErrorGuard(): void
    {
        $this->fatalGuardArmed = true;
    }

    /** Drives the fatal-error-at-shutdown logic directly, the one thing this spy can't provoke for real. */
    public function simulateFatalErrorAtShutdown(?array $error): void
    {
        $this->handleFatalErrorAtShutdown($error);
    }

    /**
     * The options the real transport would use, so the timeout — and the body — are something a
     * test can read back. post() is overridden here, so nothing else in this suite ever touches
     * curlOptions(): whatever is not asserted from this seam is not covered at all.
     */
    public function realCurlOptions(string $body = '{}'): array
    {
        return $this->curlOptions($body);
    }

    /** @return list<string> the outcome of each report, in order */
    public function outcomes(): array
    {
        return array_column(array_column($this->posts, 'payload'), 'outcome');
    }
}
