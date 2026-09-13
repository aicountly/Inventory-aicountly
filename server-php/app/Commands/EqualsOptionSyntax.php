<?php

namespace App\Commands;

use CodeIgniter\CLI\CLI;

/**
 * Accept `--option=value` as well as `--option value`.
 *
 * CodeIgniter's own parser only understands the space-separated form: it walks argv and treats
 * anything starting with "-" as an option name, taking the NEXT argument as its value. So
 * `--limit=300` is registered under the key "limit=300" with a null value, and getOption('limit')
 * returns null — the command silently uses its default and reports having done so in small print.
 *
 * That is a quiet failure of exactly the wrong kind for scheduled work: an installed cron line
 * reading `--limit=300` ran at the default 100 a minute for hours before anyone noticed the
 * backlog was draining three times too slowly.
 *
 * Every command that reads an option calls normaliseEqualsOptions() first. The space-separated
 * form keeps working and wins, because it is what the parser actually saw.
 */
trait EqualsOptionSyntax
{
    protected function normaliseEqualsOptions(): void
    {
        $found = [];
        foreach ($_SERVER['argv'] ?? [] as $arg) {
            if (!is_string($arg) || strpos($arg, '--') !== 0 || strpos($arg, '=') === false) {
                continue;
            }
            [$key, $value] = explode('=', ltrim($arg, '-'), 2);
            if ($key !== '' && CLI::getOption($key) === null) {
                $found[$key] = $value;
            }
        }
        if ($found === []) {
            return;
        }

        // CLI keeps its parsed options in a static; there is no public setter, so this is the only
        // way to correct them without re-implementing the whole parser.
        $ref = new \ReflectionProperty(CLI::class, 'options');
        $ref->setAccessible(true);
        $ref->setValue(null, array_merge(CLI::getOptions(), $found));
    }
}
