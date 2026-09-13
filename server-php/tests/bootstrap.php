<?php

/**
 * PHPUnit bootstrap — polyfill intl Locale when ext-intl is not loaded (common on Windows CI).
 */
if (! extension_loaded('intl') && ! class_exists('Locale', false)) {
    class Locale
    {
        private static string $default = 'en';

        public static function getDefault(): string
        {
            return self::$default;
        }

        public static function setDefault(string $locale): bool
        {
            self::$default = $locale;

            return true;
        }

        public static function acceptFromHttp(string $header): ?string
        {
            return self::$default;
        }
    }
}

require __DIR__ . '/../vendor/codeigniter4/framework/system/Test/bootstrap.php';

/**
 * Run every test in the application's own timezone.
 *
 * The schema stores naive local timestamps (created_at, expires_at, document dates), so any
 * assertion on a stored timestamp is only meaningful under the timezone the application runs
 * in. Without this, the timezone in force depended on whether some earlier test had booted the
 * framework: adding one unrelated test file was enough to flip the suite from UTC to
 * Asia/Kolkata and break an assertion that had been passing for the wrong reason.
 */
date_default_timezone_set((new Config\App())->appTimezone);
