<?php

namespace App\Controllers\Api;

/**
 * Routes.php maps the un-versioned `GET /api/session` probe to `AccessController::session`
 * inside the App\Controllers\Api namespace group, while the implementation lives in V1.
 * This thin subclass makes that route resolve without touching the route contract.
 */
class AccessController extends V1\AccessController
{
}
