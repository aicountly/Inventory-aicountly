<?php

namespace Tests\Unit;

use App\Services\CronHeartbeat;
use PHPUnit\Framework\TestCase;
use Tests\Support\SpyCronHeartbeat;

/**
 * The cron heartbeat emitter.
 *
 * Two properties carry the whole feature and both are asserted here rather than assumed:
 *
 *   1. It NEVER breaks the job. A monitoring call that takes down the work it monitors is the
 *      worst outcome available — the work stops AND the monitor is wrong about why. Every
 *      transport fault a real deployment can produce (a throw, an Error from a host with no
 *      ext-curl, a 500, a timeout, a body that is not JSON) is swallowed.
 *
 *   2. Unconfigured means inert. No key, no HTTP, no log line, no run id. A developer machine
 *      that reported would hold production's monitor green while production's cron was dead, and
 *      an environment that was never meant to report must not write a warning on every run.
 *
 * @group unit
 */
final class CronHeartbeatTest extends TestCase
{
    private const KEY = 'CONSOLE_CRON_MONITOR_KEY';

    /** @var array<string, string|false> */
    private array $envBackup = [];

    protected function setUp(): void
    {
        parent::setUp();
        foreach ([self::KEY, 'CONSOLE_SERVICE_KEY', 'CONSOLE_API_BASE'] as $var) {
            $this->envBackup[$var] = getenv($var);
            putenv($var);
        }
    }

    protected function tearDown(): void
    {
        SpyCronHeartbeat::$next = null;
        foreach ($this->envBackup as $var => $value) {
            $value === false ? putenv($var) : putenv($var . '=' . $value);
        }
        parent::tearDown();
    }

    private function configure(string $key = 'rehearsal-console-cron-key'): void
    {
        putenv(self::KEY . '=' . $key);
    }

    /* ===================================================================== */
    /* Unconfigured means inert                                              */
    /* ===================================================================== */

    public function testAnUnsetKeyMeansNoRequestNoLogAndNoRunId(): void
    {
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->begin();
        $beat->success(['sent' => 3]);

        $this->assertSame([], $beat->posts, 'an environment with no key must not call Console at all');
        $this->assertSame([], $beat->warnings, 'and must not log a warning on every single run either');
        $this->assertNull($beat->runId());
        $this->assertFalse(CronHeartbeat::isConfigured());
    }

    public function testFailureIsAlsoSilentWhenUnconfigured(): void
    {
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->begin();
        $beat->failure('the sweep blew up');

        $this->assertSame([], $beat->posts);
        $this->assertSame([], $beat->warnings);
    }

    /** A key still holding its .env.example placeholder is not a key. */
    public function testPlaceholderKeyCountsAsUnset(): void
    {
        $this->configure('CHANGE_ME_CONSOLE_CRON_KEY');
        $this->assertFalse(CronHeartbeat::isConfigured());

        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->begin();
        $this->assertSame([], $beat->posts);
    }

    /** Products are already configured with CONSOLE_SERVICE_KEY; Console accepts it too. */
    public function testConsoleServiceKeyIsAcceptedAsAFallback(): void
    {
        putenv('CONSOLE_SERVICE_KEY=shared-product-to-console-key');
        $this->assertTrue(CronHeartbeat::isConfigured());
        $this->assertSame('shared-product-to-console-key', CronHeartbeat::serviceKey());
    }

    public function testDedicatedKeyWinsOverTheFallback(): void
    {
        putenv('CONSOLE_SERVICE_KEY=shared-product-to-console-key');
        $this->configure('dedicated-cron-key');
        $this->assertSame('dedicated-cron-key', CronHeartbeat::serviceKey());
    }

    /* ===================================================================== */
    /* What it sends                                                         */
    /* ===================================================================== */

    public function testBeginReportsAStartedRun(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->begin();

        $this->assertCount(1, $beat->posts);
        $body = $beat->posts[0]['payload'];
        $this->assertSame('inventory.outbox_dispatch', $body['monitor']);
        $this->assertSame('started', $body['outcome']);
        $this->assertArrayHasKey('started_at', $body);
        $this->assertArrayNotHasKey('finished_at', $body, 'a start that carries finished_at is not a start');
        $this->assertNotSame('', (string) $body['run_id']);
        $this->assertSame($beat->runId(), $body['run_id']);
    }

    /**
     * The pairing is the point. Console tells "ran and finished" from "started and died half way"
     * only because the two reports carry the same run_id; a finish under a fresh id would leave
     * the start open forever and every healthy run would read STUCK.
     */
    public function testFinishReusesTheRunIdFromBegin(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->begin();
        $runId = $beat->runId();
        $beat->success(['sent' => 4, 'failed' => 0]);

        $this->assertCount(2, $beat->posts);
        $this->assertSame($runId, $beat->posts[1]['payload']['run_id']);
        $this->assertSame($runId, $beat->posts[0]['payload']['run_id']);
    }

    public function testSuccessReportsOkWithCountsAndBothClocks(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->begin();
        $beat->success(['sent' => 4, 'failed' => 1], 'sent=4 failed=1');

        $body = $beat->posts[1]['payload'];
        $this->assertSame('ok', $body['outcome']);
        $this->assertSame(['sent' => 4, 'failed' => 1], $body['counts']);
        $this->assertSame('sent=4 failed=1', $body['message']);
        $this->assertArrayHasKey('started_at', $body, 'the finish carries the start time so Console can show a duration');
        $this->assertArrayHasKey('finished_at', $body);
        $this->assertArrayHasKey('sent_at', $body);
    }

    /**
     * FAILING is a state of its own: the cron is alive, it completed, and it did not work. That
     * needs a different response from OVERDUE, so it must not be reported as ok with a sad message.
     */
    public function testFailureReportsErrorNotOk(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->begin();
        $beat->failure('Books refused every event');

        $body = $beat->posts[1]['payload'];
        $this->assertSame('error', $body['outcome']);
        $this->assertSame('Books refused every event', $body['message']);
        $this->assertArrayHasKey('finished_at', $body);
    }

    public function testFailureWithoutAMessageStillSaysSomething(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->begin();
        $beat->failure('');

        $this->assertNotSame('', (string) $beat->posts[1]['payload']['message']);
    }

    /** One record of a completed run beats silence, even when the start never landed. */
    public function testFinishWithoutABeginStillReports(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->success(['sent' => 1]);

        $this->assertCount(1, $beat->posts);
        $this->assertSame('ok', $beat->posts[0]['payload']['outcome']);
        $this->assertNotSame('', (string) $beat->posts[0]['payload']['run_id']);
    }

    public function testASecondFinishIsIgnored(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->begin();
        $beat->success(['sent' => 1]);
        $beat->success(['sent' => 99]);
        $beat->failure('and now this');

        $this->assertCount(2, $beat->posts, 'one start and one finish; a run finishes once');
        $this->assertSame(['sent' => 1], $beat->posts[1]['payload']['counts']);
    }

    public function testItPostsToConsolesHeartbeatRouteWithTheServiceKeyHeader(): void
    {
        $this->configure('rehearsal-console-cron-key');
        putenv('CONSOLE_API_BASE=https://console.aicountly.org/api');
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->begin();

        $this->assertSame('https://console.aicountly.org/api/portal/cron-heartbeat', $beat->posts[0]['url']);
        $this->assertContains(
            'X-Console-Cron-Key: rehearsal-console-cron-key',
            $beat->realCurlOptions()[CURLOPT_HTTPHEADER],
        );
    }

    /* ===================================================================== */
    /* run_id                                                                */
    /* ===================================================================== */

    /** Console's column is VARCHAR(120) and it rejects anything longer — the run would vanish. */
    public function testRunIdFitsConsolesColumn(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->begin();

        $this->assertLessThanOrEqual(CronHeartbeat::MAX_RUN_ID_CHARS, strlen((string) $beat->runId()));
        $this->assertSame(120, CronHeartbeat::MAX_RUN_ID_CHARS);
    }

    /**
     * Two runs in the same second must not collide. Console upserts on (monitor, run_id), so a
     * repeated id would have the second run silently overwrite the first.
     */
    public function testRunIdsAreUniquePerExecution(): void
    {
        $this->configure();
        $ids = [];
        for ($i = 0; $i < 50; $i++) {
            $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
            $beat->begin();
            $ids[] = $beat->runId();
        }

        $this->assertCount(50, array_unique($ids));
    }

    /* ===================================================================== */
    /* It never breaks the job                                               */
    /* ===================================================================== */

    /** @return array<string, array{0: \Throwable}> */
    public static function transportFaults(): array
    {
        return [
            'connection refused'    => [new \RuntimeException('Failed to connect to console.aicountly.org port 443')],
            'dns failure'           => [new \RuntimeException('Could not resolve host: console.aicountly.org')],
            'no curl extension'     => [new \Error('Call to undefined function curl_init()')],
            'out of memory in curl' => [new \ErrorException('allowed memory size exhausted')],
        ];
    }

    /**
     * @dataProvider transportFaults
     */
    public function testATransportFaultIsSwallowedAtEveryStage(\Throwable $fault): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->throw = $fault;

        $beat->begin();
        $beat->success(['sent' => 2]);

        $this->assertCount(2, $beat->warnings, 'both the start and the finish are logged at warning');
        $this->assertStringContainsString($fault->getMessage(), $beat->warnings[0]);
    }

    /**
     * @dataProvider transportFaults
     */
    public function testAJobWhoseHeartbeatThrowsStillDoesItsWorkAndKeepsItsOwnExitStatus(\Throwable $fault): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->throw = $fault;

        // A job, written the way a spark command is written.
        $rowsProcessed = 0;
        $exit = (static function () use ($beat, &$rowsProcessed): int {
            $beat->begin();
            try {
                $rowsProcessed = 7;                    // the work
                throw new \RuntimeException('books unreachable');   // ...which failed on its own
            } catch (\Throwable $e) {
                $beat->failure($e->getMessage());

                return EXIT_ERROR;
            }
        })();

        $this->assertSame(7, $rowsProcessed, 'the work ran');
        $this->assertSame(EXIT_ERROR, $exit, 'and the job still reported its own failure, not a heartbeat fault');
        $this->assertNotSame([], $beat->warnings);
    }

    public function testAJobSucceedsEvenWhenTheHeartbeatExplodes(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->throw = new \Error('Call to undefined function curl_init()');

        $rows = 0;
        $exit = (static function () use ($beat, &$rows): int {
            $beat->begin();
            $rows = 12;
            $beat->success(['rows' => $rows]);

            return EXIT_SUCCESS;
        })();

        $this->assertSame(12, $rows);
        $this->assertSame(EXIT_SUCCESS, $exit);
    }

    /** @return array<string, array{0:int, 1:string}> */
    public static function badResponses(): array
    {
        return [
            'console 500'          => [500, '{"error":{"message":"boom"}}'],
            'console 401'          => [401, '{"error":{"message":"Invalid cron monitor service key."}}'],
            'monitor not registered' => [404, '{"error":{"message":"Unknown cron monitor"}}'],
            'key not configured'   => [503, '{"error":{"message":"Cron monitor ingest key is not configured."}}'],
            'html error page'      => [502, '<html><body>Bad Gateway</body></html>'],
            'timed out, no status' => [0, ''],
        ];
    }

    /**
     * @dataProvider badResponses
     */
    public function testAnUnhappyConsoleIsLoggedAndSwallowed(int $status, string $body): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->response = ['status' => $status, 'body' => $body, 'error' => $status === 0 ? 'Operation timed out' : ''];

        $beat->begin();
        $beat->success(['sent' => 1]);

        $this->assertCount(2, $beat->warnings);
        $this->assertStringContainsString('Console answered', $beat->warnings[0]);
        $this->assertStringContainsString(CronHeartbeat::PATH, $beat->warnings[0]);
    }

    /** A 2xx whose body is not JSON is still a delivered heartbeat; only the status decides. */
    public function testA2xxWithAnUnparseableBodyIsNotAWarning(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->response = ['status' => 200, 'body' => 'not json at all', 'error' => ''];

        $beat->begin();
        $beat->success();

        $this->assertSame([], $beat->warnings);
    }

    /** Counts that cannot be encoded must cost the counts, never the heartbeat. */
    public function testInvalidUtf8InCountsDoesNotLoseTheRun(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->begin();
        $beat->success(['note' => "bad \xB1\x31 bytes", 'sent' => 3]);

        $this->assertCount(2, $beat->posts);
        $this->assertSame('ok', $beat->posts[1]['payload']['outcome']);
        $this->assertSame([], $beat->warnings);
    }

    /**
     * The same rule for the MESSAGE, which is where bad bytes actually come from: a PDO error
     * quoting a latin1 customer name. json_encode failed, the counts-only fallback did not help,
     * and the whole finish was dropped — leaving Console holding an open 'started' row, so the
     * run read STUCK ("died half way") instead of FAILING ("ran and did not work") and somebody
     * went looking for a hung process that did not exist.
     */
    public function testInvalidUtf8InTheMessageDoesNotLoseTheFailureReport(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->begin();
        $beat->failure("SQLSTATE[22021]: bad byte \xB1\x31 in column");

        $this->assertCount(2, $beat->posts, 'the failure report must still be sent');
        $this->assertSame('error', $beat->posts[1]['payload']['outcome']);
        $this->assertStringContainsString('SQLSTATE[22021]', (string) $beat->posts[1]['payload']['message']);
        $this->assertSame([], $beat->warnings);
    }

    public function testInvalidUtf8InBothMessageAndCountsStillReportsTheOutcome(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->begin();
        $beat->failure("died on \xB1\x31", ['note' => "also \xB1\x31 bad"]);

        $this->assertCount(2, $beat->posts);
        $this->assertSame('error', $beat->posts[1]['payload']['outcome']);
        $this->assertSame([], $beat->warnings);
    }

    /**
     * counts reach Console as a JSON object or not at all. A tally whose keys are 0,1,2 encodes
     * as [1,2,3] unless it is forced, and Console refuses a counts array rather than storing
     * something it would have to display as empty — which would cost the run its heartbeat.
     */
    public function testCountsAreAlwaysSentAsAnObjectNeverAnArray(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->success([0 => 5, 1 => 6]);

        $this->assertStringContainsString('"counts":{', $beat->posts[0]['body']);
        $this->assertStringNotContainsString('"counts":[', $beat->posts[0]['body']);
    }

    /* ===================================================================== */
    /* Dying mid-run: the fatal error a catch (\Throwable) never sees        */
    /* ===================================================================== */

    /** begin() arms the guard only once a run is actually being tracked. */
    public function testBeginArmsTheFatalErrorGuardOnlyWhenConfigured(): void
    {
        $unconfigured = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $unconfigured->begin();
        $this->assertFalse($unconfigured->fatalGuardArmed);

        $this->configure();
        $configured = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $configured->begin();
        $this->assertTrue($configured->fatalGuardArmed);
    }

    /**
     * The scenario the guard exists for: memory exhaustion (or any other true fatal) kills the
     * process between begin() and the finish the work never gets to send. error_get_last() is the
     * only trace left, and it must become the failure — not silence.
     */
    public function testAFatalErrorAfterBeginIsReportedAsTheFailure(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->begin();

        $beat->simulateFatalErrorAtShutdown([
            'type' => E_ERROR, 'message' => 'Allowed memory size of 134217728 bytes exhausted',
            'file' => '/app/Services/OutboxService.php', 'line' => 88,
        ]);

        $this->assertSame(['started', 'error'], $beat->outcomes());
        $this->assertStringContainsString('Allowed memory size', (string) $beat->posts[1]['payload']['message']);
        $this->assertStringContainsString('OutboxService.php:88', (string) $beat->posts[1]['payload']['message']);
        $this->assertSame($beat->runId(), $beat->posts[1]['payload']['run_id'], 'the failure is paired with the run that started');
    }

    /** A run that already finished must not be re-reported just because some later error happened. */
    public function testAFatalErrorIsIgnoredOnceTheRunAlreadyFinished(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->begin();
        $beat->success(['sent' => 4]);

        $beat->simulateFatalErrorAtShutdown(['type' => E_ERROR, 'message' => 'unrelated', 'file' => 'x.php', 'line' => 1]);

        $this->assertCount(2, $beat->posts, 'no third post for an error after the run was already done');
        $this->assertSame('ok', $beat->posts[1]['payload']['outcome']);
    }

    /** No error at all, or nothing fatal about the last one recorded: not this run's problem. */
    public function testANonFatalLastErrorDoesNotReportAFailure(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->begin();
        $beat->simulateFatalErrorAtShutdown(null);
        $this->assertCount(1, $beat->posts, 'no error at all leaves the run open, not failed');

        $beat2 = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $this->configure();
        $beat2->begin();
        $beat2->simulateFatalErrorAtShutdown(['type' => E_WARNING, 'message' => 'array to string conversion', 'file' => 'x.php', 'line' => 1]);
        $this->assertCount(1, $beat2->posts, 'a warning is not a reason to report the run as failed');
    }

    /**
     * Under reportRun(), a finish the work reports is normally HELD for settle() to send once the
     * exit code is known. A fatal error means settle() never runs, so the guard must send the held
     * finish itself rather than leave it stuck in $pending forever.
     */
    public function testAFatalErrorSendsAFinishEvenWhenOneWasBeingHeldForSettle(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        SpyCronHeartbeat::$next = $beat;

        // Mimic reportRun()'s begin() + deferred finish, stopping short of settle() — exactly the
        // state the process is in when it fatals inside $work after already begin()-ing. $deferred
        // is private (only reportRun() itself sets it) and reflection is the only way in from here.
        $target = SpyCronHeartbeat::for('inventory.outbox_dispatch');
        $deferred = new \ReflectionProperty(CronHeartbeat::class, 'deferred');
        $deferred->setAccessible(true);
        $deferred->setValue($target, true);
        $target->begin();
        $target->success(['scanned' => 10]);

        $target->simulateFatalErrorAtShutdown([
            'type' => E_ERROR, 'message' => 'Allowed memory size exhausted', 'file' => 'x.php', 'line' => 1,
        ]);

        $this->assertSame(['started', 'error'], $beat->outcomes(), 'the fatal error must still surface, not the held ok');
    }

    /* ===================================================================== */
    /* Timeout                                                               */
    /* ===================================================================== */

    /**
     * Five seconds total, two to connect. This runs twice inside a job that has work to do, so a
     * Console that hangs rather than refuses can cost a run ten seconds and no more. The numbers
     * are asserted so that raising them is a deliberate act, and so that a curl option nobody
     * reads back cannot quietly become 0 — which means "wait forever".
     */
    public function testTheHeartbeatIsBoundedByAShortTimeout(): void
    {
        $this->assertSame(5, CronHeartbeat::TIMEOUT_SECONDS);
        $this->assertSame(2, CronHeartbeat::CONNECT_TIMEOUT_SECONDS);

        $options = (new SpyCronHeartbeat('inventory.outbox_dispatch'))->realCurlOptions();
        $this->assertSame(5, $options[CURLOPT_TIMEOUT]);
        $this->assertSame(2, $options[CURLOPT_CONNECTTIMEOUT]);
        $this->assertTrue($options[CURLOPT_RETURNTRANSFER]);
        $this->assertSame('POST', $options[CURLOPT_CUSTOMREQUEST]);
    }

    /**
     * The request that is actually sent, asserted at the only seam that sees it.
     *
     * The spy replaces post(), so the payload assertions everywhere else in this file never go
     * near curlOptions(). Detaching the body from the request there — a refactor, a merge, a
     * signature header added carelessly — used to leave the whole suite green while every
     * heartbeat became an empty POST: Console answers 422 'monitor is required', the emitter
     * swallows it by design, and every monitor reads OVERDUE while every job runs perfectly.
     */
    public function testTheRequestCarriesTheBodyAndSaysItIsJson(): void
    {
        $this->configure('a-real-cron-key');
        $body    = '{"monitor":"inventory.orphan_sweep","run_id":"r-1","outcome":"started"}';
        $options = (new SpyCronHeartbeat('inventory.orphan_sweep'))->realCurlOptions($body);

        $this->assertSame($body, $options[CURLOPT_POSTFIELDS], 'the heartbeat body must be on the request');
        $this->assertContains('Content-Type: application/json', $options[CURLOPT_HTTPHEADER]);
        $this->assertContains('Accept: application/json', $options[CURLOPT_HTTPHEADER]);
        $this->assertContains(
            CronHeartbeat::KEY_HEADER . ': a-real-cron-key',
            $options[CURLOPT_HTTPHEADER],
            'and the service key, or Console answers 401 and the run reads OVERDUE',
        );
    }

    /* ===================================================================== */
    /* Payload hygiene                                                       */
    /* ===================================================================== */

    public function testCountsAreFlattenedToScalars(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->success([
            'sent'    => 4,
            'seconds' => 1.25,
            'clean'   => true,
            'nested'  => ['no' => 'thanks'],
            'object'  => new \stdClass(),
            ''        => 9,
        ]);

        $this->assertSame(
            ['sent' => 4, 'seconds' => 1.25, 'clean' => 1],
            $beat->posts[0]['payload']['counts'],
        );
    }

    public function testAnOversizedMessageIsTrimmedRatherThanSent(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        $beat->success([], str_repeat('x', 5000));

        $this->assertSame(
            CronHeartbeat::MAX_MESSAGE_CHARS,
            mb_strlen((string) $beat->posts[0]['payload']['message']),
        );
    }

    public function testAMonitorWithNoCodeReportsNothing(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('   ');
        $beat->begin();
        $beat->success(['sent' => 1]);

        $this->assertSame([], $beat->posts, 'there is nothing Console could pair a codeless report with');
    }

    /* ===================================================================== */
    /* Endpoint resolution                                                   */
    /* ===================================================================== */

    /** @return array<string, array{0:string, 1:string}> */
    public static function bases(): array
    {
        return [
            'unset falls back to production console' => ['', 'https://console.aicountly.org/api'],
            'already an api root'                    => ['https://console.aicountly.org/api', 'https://console.aicountly.org/api'],
            'trailing slash'                         => ['https://console.aicountly.org/api/', 'https://console.aicountly.org/api'],
            'bare origin gets /api'                  => ['https://console.aicountly.org', 'https://console.aicountly.org/api'],
            'local rehearsal serves at its root'     => ['http://127.0.0.1:8090', 'http://127.0.0.1:8090'],
        ];
    }

    /**
     * @dataProvider bases
     */
    public function testApiRootResolution(string $env, string $expected): void
    {
        $env === '' ? putenv('CONSOLE_API_BASE') : putenv('CONSOLE_API_BASE=' . $env);

        $this->assertSame($expected, CronHeartbeat::apiRoot());
        $this->assertSame($expected . '/portal/cron-heartbeat', CronHeartbeat::endpoint());
    }

    /* ===================================================================== */
    /* reportRun — the one-line adoption path                                */
    /* ===================================================================== */

    /** Unconfigured on purpose: the real class is used here, and it must not touch the network. */
    public function testReportRunPassesTheExitCodeStraightBack(): void
    {
        $this->assertSame(EXIT_SUCCESS, CronHeartbeat::reportRun('inventory.outbox_dispatch', static fn (): int => EXIT_SUCCESS));
        $this->assertSame(EXIT_ERROR, CronHeartbeat::reportRun('inventory.outbox_dispatch', static fn (): int => EXIT_ERROR));
    }

    public function testReportRunReportsOkForASuccessfulRun(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        SpyCronHeartbeat::$next = $beat;

        $code = SpyCronHeartbeat::reportRun('inventory.outbox_dispatch', static fn (): int => EXIT_SUCCESS);

        $this->assertSame(EXIT_SUCCESS, $code);
        $this->assertSame(['started', 'ok'], $beat->outcomes());
    }

    /** A command that signals failure by returning EXIT_ERROR has failed, whether or not it said so. */
    public function testReportRunReportsAnErrorForANonZeroExitCode(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        SpyCronHeartbeat::$next = $beat;

        SpyCronHeartbeat::reportRun('inventory.outbox_dispatch', static fn (): int => EXIT_ERROR);

        $this->assertSame(['started', 'error'], $beat->outcomes());
        $this->assertStringContainsString('code 1', (string) $beat->posts[1]['payload']['message']);
    }

    public function testReportRunKeepsCountsTheWorkReportedItself(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        SpyCronHeartbeat::$next = $beat;

        SpyCronHeartbeat::reportRun('inventory.outbox_dispatch', static function (CronHeartbeat $b): int {
            $b->success(['scanned' => 412, 'settled' => 3]);

            return EXIT_SUCCESS;
        });

        $this->assertCount(2, $beat->posts, 'the work already finished the run; reportRun must not finish it twice');
        $this->assertSame(['scanned' => 412, 'settled' => 3], $beat->posts[1]['payload']['counts']);
    }

    /**
     * The losing combination the handover actually prescribes: the work publishes its counts with
     * success() and then returns EXIT_ERROR. Every one of those cycles used to be reported as
     * 'ok' — the first finish won and the exit-code verdict was skipped because the run was
     * already "finished" — so the console row was green on a job failing by its own account.
     */
    public function testAnExitCodeOverridesASuccessTheWorkReportedItself(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        SpyCronHeartbeat::$next = $beat;

        $code = SpyCronHeartbeat::reportRun('inventory.outbox_dispatch', static function (CronHeartbeat $b): int {
            $b->success(['scanned' => 412, 'settled' => 3], 'swept 412');

            return EXIT_ERROR;
        });

        $this->assertSame(EXIT_ERROR, $code, 'the exit code still reaches the caller unchanged');
        $this->assertSame(['started', 'error'], $beat->outcomes(), 'a failed run must never read ok');
        $this->assertCount(2, $beat->posts, 'one start, one finish — never two finishes');
        $finish = $beat->posts[1]['payload'];
        $this->assertStringContainsString('code 1', (string) $finish['message']);
        $this->assertStringContainsString('reported success first', (string) $finish['message']);
        $this->assertSame(
            ['scanned' => 412, 'settled' => 3],
            (array) $finish['counts'],
            'the counts the work published are kept — they are what it actually did',
        );
    }

    /** Same hole, reached by throwing instead of returning. */
    public function testAnExceptionOverridesASuccessTheWorkReportedItself(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        SpyCronHeartbeat::$next = $beat;

        try {
            SpyCronHeartbeat::reportRun('inventory.outbox_dispatch', static function (CronHeartbeat $b): int {
                $b->success(['scanned' => 412]);

                throw new \RuntimeException('company 41 could not be settled');
            });
            $this->fail('the work exception must reach the caller unchanged');
        } catch (\RuntimeException $e) {
            $this->assertSame('company 41 could not be settled', $e->getMessage());
        }

        $this->assertSame(['started', 'error'], $beat->outcomes());
        $this->assertStringContainsString('could not be settled', (string) $beat->posts[1]['payload']['message']);
    }

    /** And the reverse: a zero exit code must not erase a failure the work reported itself. */
    public function testAZeroExitCodeDoesNotEraseAFailureTheWorkReported(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        SpyCronHeartbeat::$next = $beat;

        SpyCronHeartbeat::reportRun('inventory.outbox_dispatch', static function (CronHeartbeat $b): int {
            $b->failure('books rejected 7 events');

            return EXIT_SUCCESS;
        });

        $this->assertSame(['started', 'error'], $beat->outcomes());
        $this->assertStringContainsString('books rejected 7 events', (string) $beat->posts[1]['payload']['message']);
    }

    /** The job's exception is the job's. Report it, then let it go on being thrown. */
    public function testReportRunReportsAndRethrows(): void
    {
        $this->configure();
        $beat = new SpyCronHeartbeat('inventory.outbox_dispatch');
        SpyCronHeartbeat::$next = $beat;

        try {
            SpyCronHeartbeat::reportRun('inventory.outbox_dispatch', static function (): int {
                throw new \RuntimeException('the sweep could not read inv_documents');
            });
            $this->fail('the work exception must reach the caller unchanged');
        } catch (\RuntimeException $e) {
            $this->assertSame('the sweep could not read inv_documents', $e->getMessage());
        }

        $this->assertSame('error', $beat->posts[1]['payload']['outcome']);
        $this->assertStringContainsString('could not read inv_documents', (string) $beat->posts[1]['payload']['message']);
    }
}
