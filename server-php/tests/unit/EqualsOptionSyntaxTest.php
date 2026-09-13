<?php

namespace Tests\Unit;

use App\Commands\EqualsOptionSyntax;
use CodeIgniter\CLI\CLI;
use PHPUnit\Framework\TestCase;

/**
 * `--option=value` must reach the command. CodeIgniter's parser only splits `--option value`,
 * so without this a cron line reading --limit=300 runs at the default and says nothing.
 *
 * @group unit
 */
final class EqualsOptionSyntaxTest extends TestCase
{
    private array $argvBackup = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->argvBackup = $_SERVER['argv'] ?? [];
    }

    protected function tearDown(): void
    {
        $_SERVER['argv'] = $this->argvBackup;
        $this->setOptions([]);
        parent::tearDown();
    }

    /** @param array<string, mixed> $options */
    private function setOptions(array $options): void
    {
        $ref = new \ReflectionProperty(CLI::class, 'options');
        $ref->setAccessible(true);
        $ref->setValue(null, $options);
    }

    /**
     * @param list<string> $argv
     * @param array<string, mixed> $parsed what CodeIgniter's own parser would have produced
     */
    private function normalise(array $argv, array $parsed): void
    {
        $_SERVER['argv'] = array_merge(['spark'], $argv);
        $this->setOptions($parsed);
        $subject = new class () {
            use EqualsOptionSyntax {
                normaliseEqualsOptions as public run;
            }
        };
        $subject->run();
    }

    public function testAnEqualsOptionBecomesReadable(): void
    {
        // What CodeIgniter actually parses from `--limit=300`: a key with the value glued on.
        $this->normalise(['inventory:outbox-dispatch', '--limit=300'], ['limit=300' => null]);

        $this->assertSame('300', CLI::getOption('limit'));
    }

    public function testTheSpaceSeparatedFormIsLeftAlone(): void
    {
        $this->normalise(['inventory:outbox-dispatch', '--limit', '300'], ['limit' => '300']);

        $this->assertSame('300', CLI::getOption('limit'));
    }

    public function testSeveralOptionsAtOnce(): void
    {
        $this->normalise(
            ['inventory:migrate-books', '--stage=migrate', '--run-id=prod-1', '--dry-run'],
            ['stage=migrate' => null, 'run-id=prod-1' => null, 'dry-run' => null],
        );

        $this->assertSame('migrate', CLI::getOption('stage'));
        $this->assertSame('prod-1', CLI::getOption('run-id'));
        // CodeIgniter reports a valueless option as true, which is what --dry-run relies on.
        $this->assertTrue(CLI::getOption('dry-run'), 'a flag stays a flag');
    }

    public function testAValueContainingAnEqualsSignSurvives(): void
    {
        $this->normalise(['x', '--dsn=pgsql:host=db;port=5432'], ['dsn=pgsql:host=db;port=5432' => null]);

        $this->assertSame('pgsql:host=db;port=5432', CLI::getOption('dsn'));
    }

    public function testAnEmptyValueIsAnEmptyStringNotNull(): void
    {
        // --company= means "no companies", which must not read as "option absent" and fall back.
        $this->normalise(['x', '--company='], ['company=' => null]);

        $this->assertSame('', CLI::getOption('company'));
    }

    public function testAnOptionAlreadyParsedProperlyIsNotOverwritten(): void
    {
        $this->normalise(['x', '--limit', '50', '--limit=300'], ['limit' => '50', 'limit=300' => null]);

        $this->assertSame('50', CLI::getOption('limit'), 'what the parser saw wins');
    }
}
