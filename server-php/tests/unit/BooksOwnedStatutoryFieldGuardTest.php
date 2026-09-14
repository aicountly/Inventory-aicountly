<?php

namespace Tests\Unit;

use App\Controllers\Api\V1\ItemsController;
use PHPUnit\Framework\TestCase;

/**
 * HSN and the Books tax category belong to Smart Books, which files the returns that use them.
 * Inventory stores them so the item screen reads whole, and Books pushes them here with its
 * service key.
 *
 * An Inventory operator editing one is not a second opinion: Books re-asserts the value from
 * books_item_gst_profile_history within the minute, so the typed value used to disappear with
 * nothing shown on either screen. The write is refused at the point of entry instead.
 *
 * @group unit
 */
final class BooksOwnedStatutoryFieldGuardTest extends TestCase
{
    private function owned(array $session, array $body, array $existing = []): ?array
    {
        $c = new ItemsController();
        $m = new \ReflectionMethod(ItemsController::class, 'booksOwnedStatutoryEdit');
        $m->setAccessible(true);

        return $m->invoke($c, $session, $body, $existing);
    }

    private const HUMAN = ['kind' => 'user', 'uuid' => 'u-1'];
    private const BOOKS = ['kind' => 'service', 'source_app' => 'books', 'uuid' => 'service:books'];

    public function testBooksMayWriteTheStatutoryFieldsItOwns(): void
    {
        $this->assertNull(
            $this->owned(self::BOOKS, ['hsn_sac' => '8471', 'books_tax_cat_id' => 9], ['hsn_sac' => '7407', 'books_tax_cat_id' => 3]),
            'the whole point of the fields being here is that Books pushes them',
        );
    }

    public function testAnInventoryOperatorCannotChangeTheHsn(): void
    {
        $r = $this->owned(self::HUMAN, ['hsn_sac' => '8471'], ['hsn_sac' => '7407']);

        $this->assertNotNull($r, 'a change that Books will overwrite must not be accepted silently');
    }

    public function testAnInventoryOperatorCannotChangeTheTaxCategory(): void
    {
        $this->assertNotNull($this->owned(self::HUMAN, ['books_tax_cat_id' => 9], ['books_tax_cat_id' => 3]));
    }

    /**
     * The item form PUTs the whole row back, so the overwhelmingly common request carries these
     * fields at their stored value. Refusing that would break every edit made in Inventory.
     */
    public function testEchoingTheStoredValueIsNotAnEdit(): void
    {
        $this->assertNull(
            $this->owned(self::HUMAN, ['hsn_sac' => '7407', 'books_tax_cat_id' => 3, 'item_name' => 'Renamed'], ['hsn_sac' => '7407', 'books_tax_cat_id' => 3]),
            'renaming an item must not be blocked by the HSN it did not touch',
        );
    }

    public function testAFieldTheRequestDoesNotCarryIsNotAnEdit(): void
    {
        $this->assertNull($this->owned(self::HUMAN, ['item_name' => 'Renamed'], ['hsn_sac' => '7407']));
    }

    /** A non-Books service key is not Books, and gets no exemption. */
    public function testAnotherServiceKeyGetsNoExemption(): void
    {
        $this->assertNotNull(
            $this->owned(['kind' => 'service', 'source_app' => 'sales'], ['hsn_sac' => '8471'], ['hsn_sac' => '7407']),
        );
    }
}
