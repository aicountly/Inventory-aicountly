<?php

namespace Tests\Unit;

use App\Controllers\Api\V1\DocumentsController;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\IdempotencyService;
use CodeIgniter\Config\Services;
use CodeIgniter\HTTP\ResponseInterface;
use CodeIgniter\Test\CIUnitTestCase;

/**
 * GET /v1/inventory-documents/lines — the lines of many documents in one call.
 *
 * Books builds FORM GST ITC-04 out of every job-work challan in a quarter. Without this it has to
 * GET each document in turn: one round trip, and one API timeout of exposure, per challan, inside
 * the request the user is waiting on.
 *
 * @group unit
 */
final class DocumentLinesBulkReadTest extends CIUnitTestCase
{
    /** @var list<array{cmp_id:int, ids:list<int>}> */
    private array $asked = [];

    /** @param array<int, list<array<string, mixed>>> $lines */
    private function controller(string $documentIds, array $lines = []): DocumentsController
    {
        $controller = new class () extends DocumentsController {
            public function __construct()
            {
            }

            protected function authorize(?string $permission, bool $requireContext = true, bool $requireFy = true): array
            {
                return ['session' => ['kind' => 'user', 'uuid' => 'u-1'], 'ctx' => ['cmp_id' => 101, 'fy_id' => 5, 'bo_id' => 0]];
            }
        };

        $documents = $this->createMock(DocumentService::class);
        $documents->method('linesForDocuments')->willReturnCallback(function (int $cmpId, array $ids) use ($lines) {
            $this->asked[] = ['cmp_id' => $cmpId, 'ids' => $ids];
            $out = [];
            foreach ($ids as $id) {
                if (isset($lines[$id])) {
                    $out[$id] = $lines[$id];
                }
            }

            return $out;
        });

        $ref = new \ReflectionClass(DocumentsController::class);
        foreach (['documents' => $documents, 'posting' => $this->createMock(DocumentPostingService::class), 'idempotency' => $this->createMock(IdempotencyService::class)] as $name => $value) {
            $p = $ref->getProperty($name);
            $p->setAccessible(true);
            $p->setValue($controller, $value);
        }

        $request = Services::request(null, false);
        $request->setGlobal('get', ['document_ids' => $documentIds]);
        $controller->initController($request, Services::response(null, false), Services::logger(false));

        return $controller;
    }

    /** @param array<int, list<array<string, mixed>>> $lines */
    private function read(string $documentIds, array $lines = []): ResponseInterface
    {
        return $this->controller($documentIds, $lines)->lines();
    }

    /** @return array<string, mixed> */
    private function body(ResponseInterface $res): array
    {
        return json_decode((string) $res->getBody(), true) ?? [];
    }

    public function testOneCallAnswersForEveryDocumentAsked(): void
    {
        $res = $this->read('8801,8802', [
            8801 => [['line_id' => 1, 'item_id' => 90, 'qty' => 120.0, 'direction' => 'out']],
            8802 => [['line_id' => 2, 'item_id' => 90, 'qty' => 118.0, 'direction' => 'in']],
        ]);

        $this->assertSame(200, $res->getStatusCode());
        $data = $this->body($res)['data'];
        $this->assertSame([8801, 8802], array_map('intval', array_keys($data)));
        $this->assertSame('out', $data[8801][0]['direction']);
        $this->assertSame([['cmp_id' => 101, 'ids' => [8801, 8802]]], $this->asked);
    }

    /** A document of another company, or one with no lines, answers as nothing — never as a gap. */
    public function testADocumentWithNothingToShowStillAnswers(): void
    {
        $data = $this->body($this->read('8801,7777', [8801 => [['line_id' => 1]]]))['data'];

        $this->assertSame([], $data[7777]);
    }

    public function testRubbishAndRepeatedIdsAreNotPassedOn(): void
    {
        $this->read('8801, 8801 ,0,-3,abc,8802');

        $this->assertSame([8801, 8802], $this->asked[0]['ids']);
    }

    public function testTheCallIsRefusedRatherThanAnsweringForTheWholeCompany(): void
    {
        $this->assertSame(400, $this->read('')->getStatusCode());
        $this->assertSame([], $this->asked, 'no ids means no query at all');
    }

    public function testMoreDocumentsThanOneCallTakesAreRefused(): void
    {
        $res = $this->read(implode(',', range(1, 501)));

        $this->assertSame(422, $res->getStatusCode());
        $this->assertSame([], $this->asked);
        $this->assertSame(500, $this->body($res)['error']['details']['limit']);
    }
}
