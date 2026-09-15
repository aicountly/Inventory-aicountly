<?php

namespace Tests\Unit;

use App\Commands\InventoryOutboxDispatch;
use App\Services\BooksApiClient;
use App\Services\CronHeartbeat;
use App\Services\OutboxService;
use CodeIgniter\CLI\CLI;
use CodeIgniter\Test\StreamFilterTrait;
use PHPUnit\Framework\TestCase;
use Tests\Support\SpyCronHeartbeat;

/**
 * inventory:outbox-dispatch is the proving client for the cron heartbeat.
 *
 * The rule the whole feature rests on is that EMITTING A HEARTBEAT MUST NEVER BREAK THE JOB THAT
 * EMITS IT. That is easy to state and easy to lose: one un-caught call added to a command in six
 * months' time turns an unreachable Console into a dispatcher that stops delivering accounting
 * events — the monitoring taking down the work it monitors, which is worse than having no monitor
 * at all.
 *
 * So this asserts it against the real command: with a heartbeat that throws on every single call,
 * the command still runs its dispatch, still prints what it did, and still returns the exit code
 * its OWN work earned — not one the heartbeat decided.
 *
 * @group unit
 */
final class OutboxDispatchHeartbeatTest extends TestCase
{
    use StreamFilterTrait;

    /** @var array<string, string|false> */
    private array $envBackup = [];

    private array $argvBackup = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpStreamFilterTrait();
        $this->argvBackup = $_SERVER['argv'] ?? [];
        $_SERVER['argv']  = ['spark', 'inventory:outbox-dispatch'];
        foreach (['CONSOLE_CRON_MONITOR_KEY', 'CONSOLE_SERVICE_KEY', 'CONSOLE_API_BASE'] as $var) {
            $this->envBackup[$var] = getenv($var);
            putenv($var);
        }
        putenv('CONSOLE_CRON_MONITOR_KEY=rehearsal-console-cron-key');
    }

    protected function tearDown(): void
    {
        foreach ($this->envBackup as $var => $value) {
            $value === false ? putenv($var) : putenv($var . '=' . $value);
        }
        $_SERVER['argv'] = $this->argvBackup;
        $this->tearDownStreamFilterTrait();
        parent::tearDown();
    }

    private function command(OutboxService $dispatcher, CronHeartbeat $beat): InventoryOutboxDispatch
    {
        // run() needs neither the logger nor the commands collection, and booting the framework's
        // service container for a test about exit codes would only add ways for it to fail.
        $command = (new \ReflectionClass(TestableOutboxDispatch::class))->newInstanceWithoutConstructor();
        $command->fakeDispatcher = $dispatcher;
        $command->fakeHeartbeat  = $beat;

        return $command;
    }

    private function exploding(): SpyCronHeartbeat
    {
        $beat        = new SpyCronHeartbeat(InventoryOutboxDispatch::MONITOR);
        $beat->throw = new \RuntimeException('Could not resolve host: console.aicountly.org');

        return $beat;
    }

    /* ===================================================================== */
    /* The heartbeat cannot change the job's outcome                         */
    /* ===================================================================== */

    public function testASuccessfulDispatchStillSucceedsWhenEveryHeartbeatThrows(): void
    {
        $dispatcher = new FakeOutbox(['sent' => 4, 'failed' => 0, 'dead' => 0, 'skipped' => 0]);
        $beat       = $this->exploding();

        $exit = $this->command($dispatcher, $beat)->run([]);

        $this->assertSame(EXIT_SUCCESS, $exit, 'an unreachable Console must not fail the dispatch');
        $this->assertSame(1, $dispatcher->calls, 'and the work must still have run');
        $this->assertStringContainsString('sent=4', $this->getStreamFilterBuffer());
        $this->assertNotSame([], $beat->warnings, 'the failure to report is logged, not raised');
    }

    /**
     * The other direction, and the one that matters more: a dispatch that failed must still read
     * as failed. A heartbeat that swallowed the command's own exit code would turn a broken job
     * into a quiet green cron line.
     */
    public function testAFailedDispatchStillFailsWhenEveryHeartbeatThrows(): void
    {
        $dispatcher = new FakeOutbox(null, new \RuntimeException('SQLSTATE 08006 could not connect to server'));
        $beat       = $this->exploding();

        $exit = $this->command($dispatcher, $beat)->run([]);

        $this->assertSame(EXIT_ERROR, $exit);
        $this->assertStringContainsString('could not connect to server', $this->getStreamFilterBuffer());
    }

    /** The heartbeat is fired before the work, so a run that dies mid-way leaves a start behind. */
    public function testTheRunIsReportedStartedBeforeTheWorkBegins(): void
    {
        $order      = [];
        $beat       = new SpyCronHeartbeat(InventoryOutboxDispatch::MONITOR);
        $beat->onPost = static function (array $payload) use (&$order): void {
            $order[] = 'beat:' . $payload['outcome'];
        };
        $dispatcher = new FakeOutbox(['sent' => 0, 'failed' => 0, 'dead' => 0, 'skipped' => 0]);
        $dispatcher->onDispatch = static function () use (&$order): void {
            $order[] = 'work';
        };

        $this->command($dispatcher, $beat)->run([]);

        $this->assertSame(['beat:started', 'work', 'beat:ok'], $order);
    }

    /* ===================================================================== */
    /* What the console screen ends up showing                               */
    /* ===================================================================== */

    public function testItReportsTheDispatchCountsUnderTheRegisteredMonitorCode(): void
    {
        $beat = new SpyCronHeartbeat(InventoryOutboxDispatch::MONITOR);
        $this->command(new FakeOutbox(['sent' => 4, 'failed' => 1, 'dead' => 0, 'skipped' => 2]), $beat)->run([]);

        $finish = $beat->posts[1]['payload'];
        $this->assertSame('inventory.outbox_dispatch', $finish['monitor']);
        $this->assertSame('ok', $finish['outcome']);
        $this->assertSame(4, $finish['counts']['sent']);
        $this->assertSame(1, $finish['counts']['failed']);
        $this->assertSame(2, $finish['counts']['skipped']);
        $this->assertSame(7, $finish['counts']['processed']);
        $this->assertSame(100, $finish['counts']['limit']);
    }

    /**
     * "Nothing was due" is a healthy run and has to be reported. A monitor only fed when there is
     * work to do goes OVERDUE on a quiet night, and a monitor that cries wolf on quiet nights is
     * one people stop reading.
     */
    public function testAnIdleRunStillFilesAHeartbeat(): void
    {
        $beat = new SpyCronHeartbeat(InventoryOutboxDispatch::MONITOR);
        $exit = $this->command(new FakeOutbox(['sent' => 0, 'failed' => 0, 'dead' => 0, 'skipped' => 0]), $beat)->run([]);

        $this->assertSame(EXIT_SUCCESS, $exit);
        $this->assertSame(['started', 'ok'], $beat->outcomes());
        $this->assertSame(0, $beat->posts[1]['payload']['counts']['processed']);
        $this->assertStringContainsString('No due outbox events.', $this->getStreamFilterBuffer());
    }

    /** A dispatch that could not run is FAILING, not merely absent. */
    public function testAThrownDispatchIsReportedAsAnError(): void
    {
        $beat = new SpyCronHeartbeat(InventoryOutboxDispatch::MONITOR);
        $this->command(new FakeOutbox(null, new \RuntimeException('SQLSTATE 08006 could not connect to server')), $beat)->run([]);

        $finish = $beat->posts[1]['payload'];
        $this->assertSame('error', $finish['outcome']);
        $this->assertStringContainsString('could not connect to server', (string) $finish['message']);
        $this->assertSame($beat->posts[0]['payload']['run_id'], $finish['run_id'], 'the failed run is the run that started');
    }

    /**
     * DEAD events are accounting events this deployment has given up on for good — 20 attempts
     * and never retried again. "It ran, it completed, and it did not work" is the FAILING state,
     * and reporting it as ok kept the monitor out of the alerting count entirely: whoever scans
     * red rows on the daily open saw a green row over 37 dropped events.
     */
    public function testDeadEventsAreReportedAsAFailingRunNotAnOkOne(): void
    {
        $beat = new SpyCronHeartbeat(InventoryOutboxDispatch::MONITOR);
        $exit = $this->command(new FakeOutbox(['sent' => 1, 'failed' => 0, 'dead' => 3, 'skipped' => 0]), $beat)->run([]);

        $finish = $beat->posts[1]['payload'];
        $this->assertSame('error', $finish['outcome'], 'dropped accounting events are not a healthy run');
        $this->assertSame(3, $finish['counts']['dead']);
        $this->assertStringContainsString('exhausted their retries', (string) $finish['message']);
        $this->assertSame(
            EXIT_SUCCESS,
            $exit,
            'the sweep itself did what it was told, so the command still exits 0 — only the monitor is told it failed',
        );
    }

    /** Retryable failures are not dropped work: they stay an ok run, with the number on the row. */
    public function testRetryableFailuresAreStillAnOkRun(): void
    {
        $beat = new SpyCronHeartbeat(InventoryOutboxDispatch::MONITOR);
        $this->command(new FakeOutbox(['sent' => 2, 'failed' => 5, 'dead' => 0, 'skipped' => 0]), $beat)->run([]);

        $this->assertSame('ok', $beat->posts[1]['payload']['outcome']);
        $this->assertSame(5, $beat->posts[1]['payload']['counts']['failed']);
    }

    /* ===================================================================== */
    /* A run that could not read the outbox is not a quiet night             */
    /* ===================================================================== */

    /**
     * The one condition that must never read green: the job could not do its work at all.
     *
     * DBDebug is FALSE in every deployed environment, so a failed read answers false rather than
     * throwing, and dispatch() used to turn that into ['sent'=>0,'failed'=>0,'dead'=>0,
     * 'skipped'=>0] — byte-identical to a genuinely quiet run. The command could not tell them
     * apart, reported outcome=ok with processed=0, and Console showed a green, non-alerting row
     * for as long as the database stayed down while not one accounting event was delivered.
     *
     * Reproduced honestly: a real connection with DBDebug off and no inv_integration_events
     * table, which is exactly what get() returning false means.
     */
    private function connectionWithNoOutboxTable(): \CodeIgniter\Database\BaseConnection
    {
        if (! extension_loaded('sqlite3')) {
            $this->markTestSkipped('sqlite3 required');
        }

        return \CodeIgniter\Database\Config::connect([
            'DSN' => '', 'hostname' => '', 'username' => '', 'password' => '', 'database' => ':memory:',
            'DBDriver' => 'SQLite3', 'DBPrefix' => '', 'pConnect' => false,
            // As deployed. This is the whole point: the read fails quietly.
            'DBDebug' => false,
            'charset' => 'utf8', 'DBCollat' => '', 'swapPre' => '', 'encrypt' => false, 'compress' => false,
            'strictOn' => false, 'failover' => [], 'port' => 3306, 'foreignKeys' => false, 'busyTimeout' => 1000,
        ], false);
    }

    private static function connectionCache(): \ReflectionProperty
    {
        $p = new \ReflectionProperty(\CodeIgniter\Database\Config::class, 'instances');
        $p->setAccessible(true);

        return $p;
    }

    public function testAnUnreadableOutboxIsAFailedRunNotAnIdleOne(): void
    {
        $db    = $this->connectionWithNoOutboxTable();
        $cache = self::connectionCache();
        $saved = $cache->getValue();
        $cache->setValue(null, array_merge($saved, ['tests' => $db, 'default' => $db]));

        try {
            $beat = new SpyCronHeartbeat(InventoryOutboxDispatch::MONITOR);
            $exit = $this->command(new OutboxService(), $beat)->run([]);

            $this->assertSame(EXIT_ERROR, $exit, 'a run that could not read its queue has not succeeded');
            $this->assertSame(['started', 'error'], $beat->outcomes(), 'and must never be reported as ok');
            $this->assertStringContainsString(
                'inv_integration_events',
                (string) $beat->posts[1]['payload']['message'],
                'the message has to say what could not be read',
            );
        } finally {
            $cache->setValue(null, $saved);
            $db->close();
        }
    }

    /** The same fault on the user request path stays swallowed: monitoring never breaks the work. */
    public function testTheOnContactDrainStillSwallowsAnUnreadableOutbox(): void
    {
        $db    = $this->connectionWithNoOutboxTable();
        $cache = self::connectionCache();
        $saved = $cache->getValue();
        $cache->setValue(null, array_merge($saved, ['tests' => $db, 'default' => $db]));

        try {
            $this->assertSame(
                ['sent' => 0, 'failed' => 0, 'dead' => 0, 'skipped' => 0],
                (new OutboxService())->settleOnContact(101),
                'a broken outbox read must not reach the document the user is posting',
            );
        } finally {
            $cache->setValue(null, $saved);
            $db->close();
        }
    }

    public function testTheLimitOptionReachesTheHeartbeatCounts(): void
    {
        $_SERVER['argv'] = ['spark', 'inventory:outbox-dispatch', '--limit=250'];
        $beat            = new SpyCronHeartbeat(InventoryOutboxDispatch::MONITOR);
        $dispatcher      = new FakeOutbox(['sent' => 0, 'failed' => 0, 'dead' => 0, 'skipped' => 0]);

        $this->command($dispatcher, $beat)->run([]);

        $this->assertSame(250, $dispatcher->limit);
        $this->assertSame(250, $beat->posts[1]['payload']['counts']['limit']);

        $ref = new \ReflectionProperty(CLI::class, 'options');
        $ref->setAccessible(true);
        $ref->setValue(null, []);
    }
}

/** Exposes the two seams the real command uses to build its collaborators. */
final class TestableOutboxDispatch extends InventoryOutboxDispatch
{
    public OutboxService $fakeDispatcher;
    public CronHeartbeat $fakeHeartbeat;

    protected function heartbeat(): CronHeartbeat
    {
        return $this->fakeHeartbeat;
    }

    protected function dispatcher(): OutboxService
    {
        return $this->fakeDispatcher;
    }
}

/** An outbox that answers with fixed counts, or throws, without a database. */
final class FakeOutbox extends OutboxService
{
    public int $calls = 0;
    public int $limit = 0;

    /** @var null|callable():void */
    public $onDispatch = null;

    public function __construct(private ?array $result = null, private ?\Throwable $throw = null)
    {
    }

    public function dispatch(int $limit = 100, ?BooksApiClient $books = null, ?int $cmpId = null, bool $stopOnFailure = false): array
    {
        $this->calls++;
        $this->limit = $limit;
        if ($this->onDispatch !== null) {
            ($this->onDispatch)();
        }
        if ($this->throw !== null) {
            throw $this->throw;
        }

        return $this->result ?? ['sent' => 0, 'failed' => 0, 'dead' => 0, 'skipped' => 0];
    }
}
