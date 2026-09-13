<?php

namespace Tests\Unit;

use CodeIgniter\Test\CIUnitTestCase;

/**
 * Every `use App\...` in the codebase must point at a class that exists.
 *
 * This is not a style rule. App\Services\PortalCompanyAccessService was imported by
 * Api\BaseController from the first commit but never written, so every
 * session-authenticated request from a delegated user hit "Class not found" — a fatal
 * error, which CodeIgniter turns into a 500 with an empty body. Service-key callers
 * return before that line, so the API looked healthy from Books and from curl while the
 * browser saw nothing but failures.
 */
final class ClassReferencesResolveTest extends CIUnitTestCase
{
    public function testEveryImportedAppClassExists(): void
    {
        $root = realpath(__DIR__ . '/../../app');
        $this->assertIsString($root);

        $declared = [];
        $imports  = [];

        /** @var \SplFileInfo $file */
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root)) as $file) {
            if ($file->isDir() || $file->getExtension() !== 'php') {
                continue;
            }
            $source = (string) file_get_contents($file->getPathname());

            if (preg_match('/^namespace\s+([^;]+);/m', $source, $ns) === 1) {
                $namespace = trim($ns[1]);
                preg_match_all('/^\s*(?:final\s+|abstract\s+)*(?:class|interface|trait|enum)\s+(\w+)/m', $source, $types);
                foreach ($types[1] as $type) {
                    $declared[$namespace . '\\' . $type] = true;
                }
            }

            preg_match_all('/^use\s+(App\\\\[\w\\\\]+)(?:\s+as\s+\w+)?\s*;/m', $source, $used);
            foreach ($used[1] as $fqcn) {
                $imports[$fqcn][] = str_replace($root . '/', '', $file->getPathname());
            }
        }

        $this->assertNotEmpty($declared, 'No classes were discovered under app/ — the scan is broken.');

        $missing = [];
        foreach ($imports as $fqcn => $files) {
            if (!isset($declared[$fqcn])) {
                $missing[] = $fqcn . ' (imported by ' . implode(', ', array_unique($files)) . ')';
            }
        }

        $this->assertSame([], $missing, "Imported classes that do not exist:\n" . implode("\n", $missing));
    }
}
