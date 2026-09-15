<?php

namespace Tests\Integration;

use App\Controllers\Api\V1\ItemsController;
use App\Exceptions\InventoryException;
use App\Services\MasterMirrorService;
use Tests\Support\IntegrationTestCase;

/**
 * The item-level ITC attribute on the item master and on every read Books makes of it.
 *
 * Inventory STORES a fact about the goods — this thing is a motor vehicle, this thing is a food and
 * beverage — and reports it. It makes no tax determination, computes no tax consequence and holds
 * no precedence rule; Books resolves the attribute against the tax category, the purchase ledger
 * and the voucher line and books the result. So what has to hold here is narrow and exact:
 *
 *   - the column exists, defaults to 'inherit', and every item that predates it is on that default;
 *   - a write keeps the value, and a value outside the three words is refused rather than coerced;
 *   - every read Books already consumes carries it — GET /v1/items (the paged list the
 *     InventoryMasterReader walks), GET /v1/items/search, POST /v1/items/bulk-lookup — and so does
 *     the inventory.item.upserted mirror event.
 *
 * The reads are exercised through the controller's own column lists and its own base query, so a
 * column dropped from any one of those three selects fails here rather than in Books.
 *
 * @group integration
 */
final class ItemItcAttributeTest extends IntegrationTestCase
{
    private int $pcs;

    protected function setUp(): void
    {
        parent::setUp();
        $this->pcs = $this->makeUnit();
    }

    /** The controller without its HTTP plumbing: these two touch the database and nothing else. */
    private function controller(): ItemsController
    {
        return (new \ReflectionClass(ItemsController::class))->newInstanceWithoutConstructor();
    }

    private function constant(string $name): string
    {
        return (string) (new \ReflectionClass(ItemsController::class))->getConstant($name);
    }

    /** One row as a given read endpoint would return it. */
    private function readWith(string $columnsConstant, int $itemId): array
    {
        $m = new \ReflectionMethod(ItemsController::class, 'baseQuery');
        $m->setAccessible(true);
        $b = $m->invoke($this->controller(), $this->cmpId);

        return $b->where('i.item_id', $itemId)->select($this->constant($columnsConstant))->get()->getRowArray() ?? [];
    }

    /** @param array<string, mixed> $body */
    private function buildRow(array $body, ?array $existing = null): array
    {
        $m = new \ReflectionMethod(ItemsController::class, 'buildRow');
        $m->setAccessible(true);

        return $m->invoke($this->controller(), $this->cmpId, $body, $existing);
    }

    // ------------------------------------------------------------------ the default

    /**
     * The whole safety of adding the attribute: an item written without it — every item that
     * existed before this migration — reads back saying nothing, so Books resolves exactly as it
     * did before and nothing already posted restates.
     */
    public function testAnItemWrittenWithoutTheAttributeIsInherit(): void
    {
        $item = $this->makeItem('Widget', $this->pcs);

        $row = $this->db->table('inv_items')->where('item_id', $item)->get()->getRowArray();
        $this->assertSame('inherit', $row['itc_eligibility']);
    }

    // ------------------------------------------------------------------ writing it

    public function testTheAttributeIsWrittenFromTheItemPayload(): void
    {
        $row = $this->buildRow(['item_name' => 'Company car', 'unit_id' => $this->pcs, 'itc_eligibility' => 'block']);
        $this->assertSame('block', $row['itc_eligibility']);

        $row = $this->buildRow(['item_name' => 'Raw material', 'unit_id' => $this->pcs, 'itc_eligibility' => 'claim']);
        $this->assertSame('claim', $row['itc_eligibility']);
    }

    /** A payload that says nothing about it says 'inherit', not NULL — the column is NOT NULL. */
    public function testAPayloadThatOmitsItSaysInherit(): void
    {
        $this->assertSame('inherit', $this->buildRow(['item_name' => 'Widget', 'unit_id' => $this->pcs])['itc_eligibility']);
    }

    /**
     * The refusal, at the level a real create/update runs at. Coercing "blocked" to "inherit" would
     * leave the operator believing the item blocks the credit while Books went on claiming it.
     */
    public function testAValueOutsideTheThreeIsRefusedByTheWritePath(): void
    {
        try {
            $this->buildRow(['item_name' => 'Company car', 'unit_id' => $this->pcs, 'itc_eligibility' => 'blocked']);
            $this->fail('expected a validation refusal');
        } catch (InventoryException $e) {
            $this->assertSame(422, $e->httpStatus());
            $this->assertStringContainsString('itc_eligibility', $e->getMessage());
            $this->assertSame('itc_eligibility', $e->details()['field'] ?? null);
        }
    }

    /** An update PUTs the whole row back, so the stored value survives a save that does not mention it. */
    public function testAnUpdateThatDoesNotMentionItKeepsTheStoredValue(): void
    {
        $item = $this->makeItem('Company car', $this->pcs);
        $this->db->table('inv_items')->where('item_id', $item)->update(['itc_eligibility' => 'block']);
        $existing = $this->db->table('inv_items')->where('item_id', $item)->get()->getRowArray();

        $row = $this->buildRow(array_merge($existing, ['item_alias' => 'Car']), $existing);
        $this->assertSame('block', $row['itc_eligibility']);
    }

    // ------------------------------------------------------------------ reading it

    public function testEveryItemReadBooksConsumesCarriesTheAttribute(): void
    {
        $item = $this->makeItem('Company car', $this->pcs);
        $this->db->table('inv_items')->where('item_id', $item)->update(['itc_eligibility' => 'block']);

        foreach (['LIST_COLUMNS' => 'GET /v1/items', 'SEARCH_COLUMNS' => 'GET /v1/items/search', 'LOOKUP_COLUMNS' => 'POST /v1/items/bulk-lookup'] as $constant => $endpoint) {
            $row = $this->readWith($constant, $item);
            $this->assertArrayHasKey('itc_eligibility', $row, $endpoint . ' must report the attribute');
            $this->assertSame('block', $row['itc_eligibility'], $endpoint . ' must report the stored value');
        }
    }

    /**
     * GET /v1/items/{id} — read through the controller's OWN column list, not a re-typed one.
     *
     * This used to build its own query and select 'i.*, u.unit_symbol', so it asserted that the
     * DATABASE has the column, never that the endpoint returns it: narrowing show()'s select to an
     * explicit list without itc_eligibility left it green. The other three reads in this file were
     * guarded properly, through LIST_COLUMNS / SEARCH_COLUMNS / LOOKUP_COLUMNS, which is what made
     * this one look covered. Books proxies this read and stanceFromItemRow() takes an absent key
     * as "the item says nothing", so a motor vehicle marked 'block' would go on having its credit
     * claimed — a GST return figure — with nothing in either product failing.
     */
    public function testTheSingleItemReadCarriesTheAttribute(): void
    {
        $item = $this->makeItem('Company car', $this->pcs);
        $this->db->table('inv_items')->where('item_id', $item)->update(['itc_eligibility' => 'claim']);

        $row = $this->readWith('SHOW_COLUMNS', $item);

        $this->assertArrayHasKey('itc_eligibility', $row, 'GET /v1/items/{id} must report the attribute');
        $this->assertSame('claim', $row['itc_eligibility']);
    }

    /** And the three call sites that answer with a whole item all use that one list. */
    public function testEverySingleItemAnswerUsesTheSameColumnList(): void
    {
        $src = file_get_contents((new \ReflectionClass(ItemsController::class))->getFileName());
        $this->assertSame(
            3,
            substr_count((string) $src, 'select(self::SHOW_COLUMNS)'),
            'show(), create() and update() must all answer with SHOW_COLUMNS, or one of them can be narrowed alone',
        );
        $this->assertStringNotContainsString(
            "select('i.*, u.unit_symbol, u.unit_name",
            (string) $src,
            'the column list is named once; a re-typed copy is a narrowing waiting to happen',
        );
    }

    /** Books also receives items on the mirror event, and the two sources must not disagree. */
    public function testTheMirrorEventCarriesTheAttribute(): void
    {
        $item = $this->makeItem('Company car', $this->pcs);
        $this->db->table('inv_items')->where('item_id', $item)->update(['itc_eligibility' => 'block']);

        $this->assertNotNull((new MasterMirrorService())->publishItem($this->cmpId, $item));
        $event = $this->db->table('inv_integration_events')->where('aggregate_type', 'item')->orderBy('event_id', 'DESC')->get()->getRowArray();
        $payload = json_decode((string) $event['payload_json'], true);

        $this->assertSame('inventory.item.upserted', $event['event_type']);
        $this->assertSame('block', $payload['itc_eligibility'] ?? null);
    }

    public function testTheFormOffersExactlyTheThreeStates(): void
    {
        $this->assertSame(['inherit', 'claim', 'block'], ItemsController::ITC_ELIGIBILITY);
    }
}
