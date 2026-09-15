# Cross-service call rule: no synchronous re-entry

**A synchronous request from SaaS A to SaaS B must not have SaaS B synchronously re-enter
SaaS A on the same request path.**

This is an architectural invariant across the Aicountly fleet, not a style preference. It is
written down because breaking it took production down in September 2026 and the failure is
invisible from inside any single process.

## Why: PHP-FPM cross-pool starvation, not application recursion

Each SaaS runs in its own PHP-FPM pool with its own `pm.max_children`, and those numbers are
small. A synchronous HTTP call parks the calling worker for the entire round trip — it is not
doing work, it is sitting in `read()`.

So when Manage calls Books and Books calls Manage back:

```
Manage worker  --HTTP-->  Books worker  --HTTP-->  Manage worker
    (blocked)                (blocked)                (blocked)
```

Three workers across two pools are consumed to serve one user action, and two of them are
doing nothing but waiting. At a handful of concurrent users every child in **both** pools is
blocked on the other pool, neither can make progress, and the queue answers **504**.

Two properties of this failure matter:

1. **Nothing recurses.** Each process makes exactly one outbound call and then blocks. There
   is no growing stack, no repeated function entry, no re-entrant flag to trip. A depth
   counter, an "already running" guard, or a recursion check *inside a single process* cannot
   see this and will never fire. What runs out is **workers**, in two pools at once.

2. **Raising `pm.max_children` does not fix it.** It raises the number of concurrent users
   required to deadlock and doubles the memory both pools need to get there. The deadlock is
   still reachable, and now it is more expensive. This is not a capacity problem.

## The incident

Manage's access directory (`GET /companies/{id}/access`) called Books
`GET /api/access/members` on **every normal read**. Serving that one call made Books re-enter
Manage repeatedly:

| Books code path | Call back into Manage |
| --- | --- |
| `BaseController::authorize()` → `enrichSessionAccessType()` | `GET /api/companyinfo` |
| …and when that was silent | `GET /api/companies?filter=all&page=N` — **once per page** |
| `AccessService::assert()` → lazy share provisioning | `GET /api/platform-invites/*` |
| `CompanyMemberService::list()` → identity enrichment | `GET /api/companies/{id}/share` |
| …then per unresolved member | `my.aicountly.com` × 9 (see below) |

One Manage page load could therefore cost a dozen Manage requests, each on its own worker,
each triggered from inside a Books request that a Manage worker was already waiting on.

A second, structurally identical loop was live between Books and Inventory:

```
Inventory write -> outbox -> POST books /api/integration/inventory/events
  -> InventoryEventHandler::acknowledgeRevisions()
    -> POST inventory /api/v1/valuation/revisions/ack
      -> BaseController::authorize() -> settleOutboxOnContact()
        -> POST books /api/integration/inventory/events   [loop]
```

## How the rule is enforced

### 1. An ordinary read does not leave the app

`CompanyAccessService::listAccess()` renders the Manage access directory entirely from
`ghm_company_access` — including the Books profile assigned at grant time
(`books_template_key`, `books_profile_id`, `books_profile_name`). Books stays operationally
authoritative for what a member can *do* in Books; it is simply not consulted in order to
draw a Manage screen.

Reconciliation (`sync_books=1`) is an explicit repair operation, triggered by a user action,
never by a page load.

### 2. Core endpoints for machine callers

`GET /api/access/members/core` (Books) serves `CompanyMemberService::listCore()`: two local
tables, no enrichment, **zero outbound calls**. It does not use `authorize()`, because
`authorize()` is itself a call back into Manage. Its gate is database-and-session only —
strictly narrower than the enriched endpoint's, so RBAC is not weakened.

When a machine caller needs data, give it a feed that reads local state. Enrichment is for
humans looking at a screen.

### 3. Callers name themselves; callees honour it

Every outbound call carries `X-Saas-Origin: <caller>`. Each app reads it through its own
`CrossServiceCallContext` and refuses to call that service back for the life of the request.

| App | Guard | Suppresses |
| --- | --- | --- |
| Books | `App\Services\CrossServiceCallContext` | `ManageCompanyShareDirectory`, `PortalCompanyAccessService`, `ManageAssignedProfileResolver`, the revision ack back to Inventory |
| Manage | `CrossServiceCallContext` | every outbound call in `BooksProvisionService::callBooks()` |
| Inventory | `App\Services\CrossServiceCallContext` | the on-contact outbox drain, `BooksApiClient::request()` |

**The header grants nothing.** It can only ever *suppress* an outbound call, and every
suppressed call is enrichment or a privilege-widening check (acs_type promotion, lazy
provisioning). Forging it costs the forger their own display name or their own
auto-provisioning; it cannot create access, a member row or a profile. Unknown values are
ignored. In Inventory the signal is stronger still: `source_app` is resolved from the
caller's `X-Service-Key`, never from a header.

Where a callee must tell the caller something, it rides back **on the response the caller is
already waiting for**. Books returns `ack_revision_ids` in its events response instead of
opening a second connection to Inventory.

### 4. Two timeout budgets, both with a connect bound

| Class | Connect | Overall | Applies to |
| --- | --- | --- | --- |
| Optional | 2–3s | 4–8s | reconciliation, read-back, identity enrichment |
| Required | 3s | 20s (Manage→Books) | provisioning, revocation, bootstrap, settings sync |

The **connect** bound matters most. A service that is up but not accepting — every child
blocked waiting on another pool — is held only by the connect timeout. Manage's single
20-second overall timeout with no connect bound is what let one unreachable Books hold a
Manage worker for twenty seconds.

An optional call that fails falls back to stored data and is forgotten. A required call
reports its failure: provisioning problems are never hidden.

Two CodeIgniter traps worth knowing: `service('curlrequest', [...])` returns a **shared**
instance and applies the options array only when it first constructs the client, so options
passed by a later caller are silently discarded — use `single_service()`. And CodeIgniter's
default `timeout` is `0.0`, which means **no timeout at all**.

### 5. Ask once, cache the miss

`PortalGlobalUserDirectory::resolveByUuid()` used to try five `/api/user/info` query shapes
and then four more paths. All nine ask `my.aicountly.com` the *same question*:
`/api/user/info`, `/api/user/profile` and `/api/user/detail` are three routes bound to one
controller action; `/api/user/{id}` and `/api/users/{id}` expand the segment into the same
parameters; and `UserProfileModel::resolveUuidFromLookup()` already walks every identifier
variant server-side. One request carrying every identifier key *is* the whole sequence.

There is no batch endpoint on `my.aicountly.com`, so one request per distinct member — with
**hits and misses both cached for the request** — is the floor.

Enrichment order is cheapest-source-first, and each per-member source runs only for the
members the whole-list sources could not answer for:

1. the stored row — free
2. the caller's own session profile — one request, cached
3. the Manage share directory — one request, cached, covers the whole company
4. Contacts — per unresolved member, cached
5. `my.aicountly.com` — per unresolved member, cached

Gate network calls on the fields the UI actually renders. Gating on a field no source
reliably supplies marks every record unresolved for ever: Books stores no mobile number and
the Manage share directory always returns `null` for it, so treating "no mobile" as "needs
enrichment" re-ran the entire remote chain for every member on every request.

### 6. Observability

Internal calls log `service`, `operation` (URL **path** only), HTTP `status` and elapsed
`ms`. Never tokens, session keys, query strings (they carry identifiers) or response bodies.
Fast successful calls are silent — these paths run on every company-scoped request, and
logging each success buries the failures the log exists to surface.

## Endpoints that must stay local

| Endpoint | Rule |
| --- | --- |
| Manage `GET /companies/{id}/share` | Database-only. Books consumes it; any outbound call here closes the loop. |
| Books `GET /api/access/members/core` | Zero outbound calls. No Manage, no My/Auth, no Contacts, no Pulse. |

## Checklist for a new cross-service call

- [ ] Can the caller answer from its own tables? Then do not make the call.
- [ ] Does the callee's handler call back into the caller — including from its auth,
      authorization or enrichment path? Trace the whole chain, not just your function.
- [ ] Is the call optional? Give it the fail-fast budget and a fallback to stored data.
- [ ] Does it set `X-Saas-Origin`?
- [ ] Are there explicit connect **and** overall timeouts?
- [ ] Is it inside a loop over rows? Hoist it, or cache hits and misses for the request.
- [ ] Is there a regression test asserting the chain terminates?
