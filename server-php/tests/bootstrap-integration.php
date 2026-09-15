<?php

/**
 * Integration test bootstrap — real PostgreSQL (INVENTORY_TEST_DB_*), minimal CI4 boot.
 */
$root = dirname(__DIR__);
require_once $root . '/vendor/autoload.php';

defined('ROOTPATH') || define('ROOTPATH', $root . DIRECTORY_SEPARATOR);
defined('APPPATH') || define('APPPATH', ROOTPATH . 'app' . DIRECTORY_SEPARATOR);
defined('SYSTEMPATH') || define('SYSTEMPATH', ROOTPATH . 'vendor/codeigniter4/framework/system' . DIRECTORY_SEPARATOR);
defined('FCPATH') || define('FCPATH', ROOTPATH . 'public' . DIRECTORY_SEPARATOR);
defined('WRITEPATH') || define('WRITEPATH', ROOTPATH . 'writable' . DIRECTORY_SEPARATOR);
defined('ENVIRONMENT') || define('ENVIRONMENT', 'testing');
defined('CI_DEBUG') || define('CI_DEBUG', false);
defined('COMPOSER_PATH') || define('COMPOSER_PATH', $root . '/vendor/autoload.php');

require_once SYSTEMPATH . 'Common.php';
require_once APPPATH . 'Config/Constants.php';

// Register the framework + app namespaces on the shared autoloader so service discovery
// (BaseService::buildServicesCache) can resolve the CodeIgniter namespace instead of warning.
\CodeIgniter\Config\Services::autoloader()->initialize(new \Config\Autoload(), new \Config\Modules());

// The schema stores naive LOCAL timestamps, so an integration test asserting on one is only
// meaningful under the timezone the application runs in — the same reason tests/bootstrap.php
// sets it for the unit suite. This minimal boot never reaches CodeIgniter's own call, so the
// integration suite was running under whatever the host happened to be (UTC here, IST on the
// deployment) and a stored-timestamp assertion passed or failed by accident of machine.
date_default_timezone_set((new Config\App())->appTimezone);
