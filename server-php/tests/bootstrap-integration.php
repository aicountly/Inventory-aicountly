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
