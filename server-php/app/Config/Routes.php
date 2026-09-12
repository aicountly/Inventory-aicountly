<?php

use CodeIgniter\Router\RouteCollection;

/**
 * AICOUNTLY Inventory API — versioned domain routes (/api/v1/...).
 *
 * CI4 is deployed under <site>/api, so route 'v1/items' answers at https://inventory.aicountly.com/api/v1/items.
 * Every route requires Authorization: Bearer <ses_key> (or X-Service-Key for trusted product backends)
 * and company context: cmp_id, fy_id, bo_id (query string or JSON body).
 */
$routes->setDefaultNamespace('App\Controllers');
$routes->setDefaultMethod('index');
$routes->setTranslateURIDashes(false);
$routes->set404Override();

$routes->group('', ['namespace' => 'App\Controllers\Api', 'filter' => 'cors'], static function ($routes) {
    $routes->options('(:any)', static function () {
        return service('response')->setStatusCode(204);
    });

    $routes->get('health', 'HealthController::index');
    $routes->get('system/revision', 'HealthController::revision');
    $routes->get('session', 'AccessController::session');

    // Portal / Manage relays (same-origin for the browser)
    $routes->match(['get', 'post', 'put', 'delete'], 'global/(:any)', 'GlobalAuthProxyController::proxy/$1');
    $routes->match(['get', 'post', 'put', 'delete'], 'manage/(:any)', 'ManageProxyController::proxy/$1');

    $routes->group('v1', ['namespace' => 'App\Controllers\Api\V1'], static function ($routes) {
        // Access & settings
        $routes->get('access/check', 'AccessController::check');
        $routes->get('access/me', 'AccessController::me');
        $routes->get('access/permissions', 'AccessController::permissionsCatalog');
        $routes->get('access/profiles', 'AccessController::profiles');
        $routes->post('access/profiles', 'AccessController::createProfile');
        $routes->put('access/profiles/(:num)', 'AccessController::updateProfile/$1');
        $routes->put('access/profiles/(:num)/permissions', 'AccessController::setPermissions/$1');
        $routes->get('access/members', 'AccessController::members');
        $routes->post('access/members', 'AccessController::addMember');
        $routes->post('access/members/provision', 'AccessController::provisionMember');
        $routes->put('access/members/(:segment)', 'AccessController::updateMember/$1');
        $routes->delete('access/members/(:segment)', 'AccessController::removeMember/$1');
        $routes->get('settings', 'SettingsController::show');
        $routes->put('settings', 'SettingsController::update');
        $routes->get('settings/period-locks', 'SettingsController::periodLocks');
        $routes->post('settings/period-locks', 'SettingsController::lockPeriod');
        $routes->delete('settings/period-locks/(:num)', 'SettingsController::releasePeriodLock/$1');
        $routes->get('document-types', 'SettingsController::documentTypes');
        $routes->get('dashboard', 'DashboardController::index');

        // Masters
        foreach ([
            'item-groups'      => 'ItemGroupsController',
            'stock-categories' => 'StockCategoriesController',
            'brands'           => 'BrandsController',
            'uom'              => 'UomController',
            'warehouse-groups' => 'WarehouseGroupsController',
            'warehouses'       => 'WarehousesController',
            'locations'        => 'LocationsController',
            'bill-of-materials'=> 'BomController',
            'batches'          => 'BatchesController',
            'serials'          => 'SerialsController',
        ] as $slug => $ctrl) {
            $routes->get($slug, $ctrl . '::index');
            $routes->get($slug . '/(:num)', $ctrl . '::show/$1');
            $routes->post($slug, $ctrl . '::create');
            $routes->put($slug . '/(:num)', $ctrl . '::update/$1');
            $routes->delete($slug . '/(:num)', $ctrl . '::delete/$1');
        }
        $routes->post('serials/bulk', 'SerialsController::bulkCreate');
        $routes->post('bill-of-materials/(:num)/explode', 'BomController::explode/$1');
        $routes->get('items/form-options', 'ItemsController::formOptions');
        $routes->get('items/search', 'ItemsController::search');
        $routes->get('items/by-barcode/(:segment)', 'ItemsController::byBarcode/$1');
        $routes->post('items/bulk-lookup', 'ItemsController::bulkLookup');
        $routes->post('items/bulk-delete', 'ItemsController::bulkDelete');
        $routes->get('items', 'ItemsController::index');
        $routes->get('items/(:num)', 'ItemsController::show/$1');
        $routes->post('items', 'ItemsController::create');
        $routes->put('items/(:num)', 'ItemsController::update/$1');
        $routes->delete('items/(:num)', 'ItemsController::delete/$1');
        $routes->get('items/(:num)/stock', 'ItemsController::stock/$1');
        $routes->get('items/(:num)/openings', 'ItemsController::openings/$1');
        $routes->put('items/(:num)/openings', 'ItemsController::saveOpenings/$1');

        // Availability & reservations
        $routes->get('availability', 'AvailabilityController::index');
        $routes->post('availability/check', 'AvailabilityController::check');
        $routes->get('stock-balances', 'AvailabilityController::balances');
        $routes->get('reservations', 'ReservationsController::index');
        $routes->post('reservations', 'ReservationsController::create');
        $routes->post('reservations/(:num)/release', 'ReservationsController::release/$1');
        $routes->post('reservations/(:num)/fulfil', 'ReservationsController::fulfil/$1');

        // Documents (all native + Books-sourced stock documents)
        $routes->get('inventory-documents', 'DocumentsController::index');
        $routes->post('inventory-documents', 'DocumentsController::create');
        $routes->post('inventory-documents/post', 'DocumentsController::createAndPost');
        $routes->get('inventory-documents/by-source', 'DocumentsController::bySource');
        $routes->get('inventory-documents/by-uuid/(:segment)', 'DocumentsController::byUuid/$1');
        $routes->get('inventory-documents/(:num)', 'DocumentsController::show/$1');
        $routes->put('inventory-documents/(:num)', 'DocumentsController::update/$1');
        $routes->post('inventory-documents/(:num)/submit', 'DocumentsController::submit/$1');
        $routes->post('inventory-documents/(:num)/approve', 'DocumentsController::approve/$1');
        $routes->post('inventory-documents/(:num)/reject', 'DocumentsController::reject/$1');
        $routes->post('inventory-documents/(:num)/post', 'DocumentsController::post/$1');
        $routes->post('inventory-documents/(:num)/reverse', 'DocumentsController::reverse/$1');
        $routes->post('inventory-documents/(:num)/revise', 'DocumentsController::revise/$1');
        $routes->post('inventory-documents/(:num)/cancel', 'DocumentsController::cancel/$1');
        $routes->get('inventory-documents/(:num)/print-snapshot', 'DocumentsController::printSnapshot/$1');
        $routes->get('pending-quantities', 'PendingController::index');
        $routes->get('packing-lists', 'PackingController::index');
        $routes->get('packing-lists/(:num)', 'PackingController::show/$1');
        $routes->post('packing-lists/(:num)/unpack', 'PackingController::unpack/$1');
        $routes->post('packing-lists/(:num)/lock', 'PackingController::lock/$1');
        $routes->post('packing-lists/(:num)/unlock', 'PackingController::unlock/$1');

        // Stock movements, ledger, valuation
        $routes->get('stock-movements', 'StockMovementsController::index');
        $routes->get('stock-ledger', 'StockMovementsController::ledger');
        $routes->get('valuation', 'ValuationController::snapshot');
        $routes->get('valuation/unit-costs', 'ValuationController::unitCosts');
        $routes->get('valuation/cost-layers', 'ValuationController::costLayers');
        $routes->get('valuation/recalculations', 'ValuationController::recalcJobs');
        $routes->post('valuation/recalculations', 'ValuationController::enqueueRecalc');
        $routes->get('valuation/recalculations/(:num)', 'ValuationController::recalcJob/$1');
        $routes->post('valuation/recalculations/(:num)/run', 'ValuationController::runRecalc/$1');
        $routes->get('valuation/revisions', 'ValuationController::revisions');
        $routes->post('valuation/revisions/ack', 'ValuationController::ackRevisions');

        // Reports
        $routes->get('reports/stock-summary', 'ReportsController::stockSummary');
        $routes->get('reports/stock-ledger', 'ReportsController::stockLedger');
        $routes->get('reports/warehouse-stock', 'ReportsController::warehouseStock');
        $routes->get('reports/batch-stock', 'ReportsController::batchStock');
        $routes->get('reports/serial-stock', 'ReportsController::serialStock');
        $routes->get('reports/stock-ageing', 'ReportsController::stockAgeing');
        $routes->get('reports/movement-analysis', 'ReportsController::movementAnalysis');
        $routes->get('reports/near-expiry', 'ReportsController::nearExpiry');
        $routes->get('reports/replenishment', 'ReportsController::replenishment');
        $routes->get('replenishment', 'ReportsController::replenishment');

        // Reconciliation with Books
        $routes->get('reconciliation', 'ReconciliationController::index');
        $routes->post('reconciliation/run', 'ReconciliationController::run');
        $routes->get('reconciliation/(:num)', 'ReconciliationController::show/$1');
        $routes->get('reconciliation/posting-status', 'ReconciliationController::postingStatus');

        // Integration (Books -> Inventory events, outbox)
        $routes->post('integration/events', 'IntegrationController::inbound');
        $routes->get('integration/outbox', 'IntegrationController::outbox');
        $routes->post('integration/outbox/(:num)/replay', 'IntegrationController::replay/$1');
        $routes->post('integration/outbox/dispatch', 'IntegrationController::dispatch');

        // Audit
        $routes->get('audit-log', 'AuditController::index');
        $routes->get('audit-log/entity/(:segment)/(:num)', 'AuditController::entity/$1/$2');
    });
});
