<?php

namespace Tests\Unit;

use App\Controllers\Api\V1\DocumentsController;
use App\Models\Api\AppCommonModel;
use App\Services\DocumentPostingService;
use App\Services\DocumentService;
use App\Services\IdempotencyService;
use CodeIgniter\Config\Services;
use CodeIgniter\HTTP\ResponseInterface;
use CodeIgniter\Test\CIUnitTestCase;

/**
 * Who a stock document belongs to (inv_documents.source_app) must come from the authenticated
 * caller, never from the request.
 *
 * A document carrying source_app='books' plus a books.* source_document_id is the stock half of
 * a named Books voucher: when it posts, the outbox event drives Books' InventoryEventHandler,
 * which writes cost_rate/cost_amount onto that voucher's inventory lines and the COGS / Stock
 * pair into its ledger lines. So an Inventory-only operator who can name the app in the body can
 * rewrite the accounting of a real invoice they have no Books permission on.
 *
 * @group unit
 */
final class DocumentSourceAppTrustTest extends CIUnitTestCase
{
    /** @var array<string, mixed>|null */
    private ?array $created = null;

    /**
     * A DocumentsController wired to canned auth and mocked services, so the test exercises the
     * controller's own trust decisions and nothing else.
     *
     * @param array<string, mixed> $session
     * @param array<string, mixed> $body
     */
    private function controller(array $session, array $body): DocumentsController
    {
        $controller = new class ($session) extends DocumentsController {
            /** @var array<string, mixed> */
            public array $session;

            /** @param array<string, mixed> $session */
            public function __construct(array $session)
            {
                $this->session = $session;
            }

            protected function authorize(?string $permission, bool $requireContext = true, bool $requireFy = true): array
            {
                return ['session' => $this->session, 'ctx' => ['cmp_id' => 101, 'fy_id' => 5, 'bo_id' => 0]];
            }

            protected function authorizeAny(array $permissions, bool $requireContext = true, bool $requireFy = true): array
            {
                return $this->authorize($permissions[0] ?? null, $requireContext, $requireFy);
            }
        };

        $documents = $this->createMock(DocumentService::class);
        $documents->method('findBySource')->willReturn(null);
        $documents->method('create')->willReturnCallback(function (array $ctx, array $payload, ?string $actor, string $sourceApp = 'inventory') {
            $this->created = ['source_app' => $sourceApp, 'payload' => $payload];

            return ['document_id' => 77, 'document_uuid' => 'uuid-77', 'status' => 'DRAFT'];
        });
        $idempotency = $this->createMock(IdempotencyService::class);
        $idempotency->method('replay')->willReturn(null);
        $posting = $this->createMock(DocumentPostingService::class);
        $posting->method('post')->willReturn(['document_id' => 77, 'document_uuid' => 'uuid-77', 'status' => 'POSTED']);

        $ref = new \ReflectionClass(DocumentsController::class);
        foreach (['documents' => $documents, 'posting' => $posting, 'idempotency' => $idempotency] as $name => $value) {
            $p = $ref->getProperty($name);
            $p->setAccessible(true);
            $p->setValue($controller, $value);
        }

        $request = Services::request(null, false);
        $request->setBody(json_encode($body));
        $response = Services::response(null, false);
        $controller->initController($request, $response, Services::logger(false));

        return $controller;
    }

    /** @param array<string, mixed> $body */
    private function create(array $session, array $body): ResponseInterface
    {
        $controller = $this->controller($session, $body);
        $m = new \ReflectionMethod(DocumentsController::class, 'createInternal');
        $m->setAccessible(true);

        return $m->invoke($controller, true);
    }

    private const USER = ['uuid' => 'u-1', 'kind' => 'user', 'source_app' => 'inventory'];
    private const BOOKS_SERVICE = ['uuid' => 'svc', 'kind' => 'service', 'source_app' => 'books'];

    /** @return array<string, mixed> */
    private static function salesIssue(array $extra = []): array
    {
        return array_merge([
            'document_type'        => 'SALES_ISSUE',
            'document_date'        => '2026-05-01',
            'source_document_type' => 'books.sales_invoice',
            'source_document_id'   => 4242,
            'lines'                => [['item_id' => 1, 'warehouse_id' => 1, 'qty' => 5, 'rate' => 900]],
        ], $extra);
    }

    public function testAnInventorySessionCannotMintTheStockHalfOfABooksVoucher(): void
    {
        $res = $this->create(self::USER, self::salesIssue(['source_app' => 'books']));

        $this->assertSame(403, $res->getStatusCode());
        $this->assertNull($this->created, 'No document may be created for a Books-owned type from a human Inventory session');
    }

    public function testAnInventorySessionCannotClaimToBeBooksEvenOnANativeDocument(): void
    {
        $res = $this->create(self::USER, [
            'document_type'        => 'STOCK_JOURNAL',
            'document_date'        => '2026-05-01',
            'source_app'           => 'books',
            'source_document_type' => 'books.sales_invoice',
            'source_document_id'   => 4242,
            'lines'                => [['item_id' => 1, 'warehouse_id' => 1, 'qty' => 5, 'direction' => 'out']],
        ]);

        $this->assertSame(403, $res->getStatusCode());
        $this->assertNull($this->created);
    }

    public function testAnInventorySessionStillCreatesItsOwnNativeDocumentAsInventory(): void
    {
        $res = $this->create(self::USER, [
            'document_type' => 'STOCK_JOURNAL',
            'document_date' => '2026-05-01',
            'lines'         => [['item_id' => 1, 'warehouse_id' => 1, 'qty' => 5, 'direction' => 'out']],
        ]);

        $this->assertSame(201, $res->getStatusCode());
        $this->assertSame('inventory', $this->created['source_app']);
    }

    public function testTheBooksServiceKeyStillCreatesTheSalesIssueAsBooks(): void
    {
        $res = $this->create(self::BOOKS_SERVICE, self::salesIssue(['source_app' => 'books']));

        $this->assertSame(201, $res->getStatusCode());
        $this->assertSame('books', $this->created['source_app']);
    }

    public function testAServiceKeyCannotClaimAnAppOtherThanItsOwn(): void
    {
        $res = $this->create(self::BOOKS_SERVICE, self::salesIssue(['source_app' => 'pos']));

        $this->assertSame(403, $res->getStatusCode());
        $this->assertNull($this->created);
    }

    /**
     * The other half of the hole: even without a body field, a browser session used to be able to
     * declare itself Books through the X-Source-App header, which BaseController::auth copied
     * straight into the session.
     */
    public function testTheXSourceAppHeaderDoesNotMakeAHumanSessionBooks(): void
    {
        $controller = $this->controller(self::USER, []);
        $request = Services::request(null, false);
        $request->setHeader('Authorization', 'Bearer ses-key');
        $request->setHeader('X-Source-App', 'books');
        $controller->initController($request, Services::response(null, false), Services::logger(false));

        $appCommon = $this->createMock(AppCommonModel::class);
        $appCommon->method('validateSesKey')->willReturn(['status' => 1, 'uuid_aictly' => 'u-1', 'acs_type' => 2]);
        $p = (new \ReflectionClass(\App\Controllers\Api\BaseController::class))->getProperty('appCommon');
        $p->setAccessible(true);
        $p->setValue($controller, $appCommon);

        $m = new \ReflectionMethod(\App\Controllers\Api\BaseController::class, 'auth');
        $m->setAccessible(true);
        $session = $m->invoke($controller);

        $this->assertSame('user', $session['kind']);
        $this->assertSame('inventory', $session['source_app']);
    }

    public function testAServiceKeySessionKeepsItsResolvedApp(): void
    {
        $controller = $this->controller(self::USER, []);
        $m = new \ReflectionMethod(\App\Controllers\Api\BaseController::class, 'resolveSourceApp');
        $m->setAccessible(true);

        $this->assertSame('books', $m->invoke($controller, self::BOOKS_SERVICE, [])['app']);
        $this->assertSame('books', $m->invoke($controller, self::BOOKS_SERVICE, ['source_app' => 'BOOKS'])['app']);
        $this->assertSame('inventory', $m->invoke($controller, self::USER, [])['app']);
    }
}
