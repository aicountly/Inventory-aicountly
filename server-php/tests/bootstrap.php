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
