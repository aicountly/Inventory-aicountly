<?php

namespace Tests\Unit;

use App\Controllers\Api\BaseController;
use App\Services\AccessService;
use App\Services\BooksApiClient;
use App\Services\OutboxService;
use CodeIgniter\Config\Services;
use CodeIgniter\Test\CIUnitTestCase;

/**
 * Delivery of the Inventory -> Books outbox in a deployment that has no cron.
 *
 * inv_integration_events is written in the same transaction as the document, the valuation
 * revision or the master change it describes, and OutboxService::dispatch() is the only thing
 * that sends it. With nothing scheduled, the only callers were the CLI sweep and an operator's
 * Dispatch button — so a posted document's COGS effects, a back-dated revaluation and every
 * cancellation sat PENDING until somebody happened to press a button. The next authenticated
 * write for the same company is the moment left to send them.
 *
 * @group unit
 */
final class OutboxOnContactDispatchTest extends CIUnitTestCase
{
    /** An OutboxService that records the on-contact drains asked of it instead of touching the database. */
    private function recordingOutbox(): OutboxService
    {
        return new class () extends OutboxService {
            /** @var list<array{cmp_id:int, limit:int}> */
            public array $drains = [];

            public function settleOnContact(int $cmpId, int $limit = 3, ?BooksApiClient $books = null): array
            {
                $this->drains[] = ['cmp_id' => $cmpId, 'limit' => $limit];

                return ['sent' => 0, 'failed' => 0, 'dead' => 0, 'skipped' => 0];
            }
        };
    }

    /**
     * A controller on the real BaseController::authorize() path with canned auth and company
     * context, so the test exercises the drain decision and nothing else.
     */
    private function controller(OutboxService $outbox, AccessService $access): BaseController
    {
        return new class ($access, $outbox) extends BaseController {
            public function __construct(AccessService $access, private OutboxService $outbox)
            {
                $this->access = $access;
            }

            protected function outboxDispatcher(): OutboxService
            {
                return $this->outbox;
            }

            protected function auth(): ?array
            {
                return ['uuid' => 'u-1', 'kind' => 'user', 'source_app' => 'inventory'];
            }

            protected function requireCompanyContext(bool $requireFy = true): ?array
            {
                return ['cmp_id' => 101, 'fy_id' => 5, 'bo_id' => 0];
            }

            protected function enrichSessionAccessType(array $session, ?array $ctx): array
            {
                return $session;
            }

            protected function logAccessDenied(?string $actorUuid, int $cmpId, string $permission, string $message): void
            {
            }

            /** @return array{session?:array, ctx?:array, response?:mixed} */
            public function callAuthorize(string $permission): array
            {
                return $this->authorize($permission);
            }
        };
    }

    private function request(string $method)
    {
        $request = Services::request(null, false);
        $request->setMethod($method);

        return $request;
    }

    /** @return list<array{cmp_id:int, limit:int}> */
    private function drainsFor(string $method, ?\RuntimeException $denial = null): array
    {
        $outbox = $this->recordingOutbox();
        $access = $this->createMock(AccessService::class);
        if ($denial !== null) {
            $access->method('assert')->willThrowException($denial);
        }
        $controller = $this->controller($outbox, $access);
        $controller->initController($this->request($method), Services::response(null, false), Services::logger(false));
        $controller->callAuthorize('documents.post');

        return $outbox->drains;
    }

    public function testAWriteRequestDeliversTheActingCompanysDueEvents(): void
    {
        foreach (['POST', 'PUT', 'PATCH', 'DELETE'] as $method) {
            $drains = $this->drainsFor($method);
            $this->assertCount(1, $drains, $method . ' must drain the outbox once');
            $this->assertSame(101, $drains[0]['cmp_id'], 'only the company the caller is authorized on');
            $this->assertLessThanOrEqual(5, $drains[0]['limit'], 'a user is waiting: take a handful of rows, not the whole queue');
        }
    }

    /** Every enqueue happens on a write; a read must not pay for somebody else's delivery. */
    public function testAReadRequestDeliversNothing(): void
    {
        $this->assertSame([], $this->drainsFor('GET'));
    }

    /** A caller refused the permission has not "made contact" with the company at all. */
    public function testARefusedRequestDeliversNothing(): void
    {
        $this->assertSame([], $this->drainsFor('POST', new \RuntimeException('Forbidden', 403)));
    }

    /**
     * The drain narrows the sweep to the acting company and gives up at the first row Books did
     * not take: without both, one user's save pays for every company's backlog and, while Books is
     * down, for one connect timeout per queued row.
     */
    public function testTheDrainIsCompanyScopedAndStopsAtTheFirstUndeliveredRow(): void
    {
        $this->assertTrue(method_exists(OutboxService::class, 'settleOnContact'), 'with no cron, the outbox needs a drain the request path can call');
        $service = new class () extends OutboxService {
            /** @var list<array{limit:int, cmp_id:?int, stop:bool}> */
            public array $calls = [];

            public function dispatch(int $limit = 100, ?BooksApiClient $books = null, ?int $cmpId = null, bool $stopOnFailure = false): array
            {
                $this->calls[] = ['limit' => $limit, 'cmp_id' => $cmpId, 'stop' => $stopOnFailure];

                return ['sent' => 1, 'failed' => 0, 'dead' => 0, 'skipped' => 0];
            }
        };

        $out = $service->settleOnContact(77);

        $this->assertSame(1, $out['sent']);
        $this->assertCount(1, $service->calls);
        $this->assertSame(77, $service->calls[0]['cmp_id']);
        $this->assertTrue($service->calls[0]['stop']);
        $this->assertLessThanOrEqual(5, $service->calls[0]['limit']);
    }

    /** The caller asked to post a document, not to deliver an older event. */
    public function testADrainThatFailsNeverReachesTheCaller(): void
    {
        $this->assertTrue(method_exists(OutboxService::class, 'settleOnContact'), 'with no cron, the outbox needs a drain the request path can call');
        $service = new class () extends OutboxService {
            public function dispatch(int $limit = 100, ?BooksApiClient $books = null, ?int $cmpId = null, bool $stopOnFailure = false): array
            {
                throw new \RuntimeException('inv_integration_events is unreadable');
            }
        };

        $this->assertSame(['sent' => 0, 'failed' => 0, 'dead' => 0, 'skipped' => 0], $service->settleOnContact(77));
    }
}
