---
name: backend-contract
description: Design and review backend service contracts — request/response shapes, validation boundaries, error taxonomy, idempotency, authorization checks and transaction scope. Use when adding an endpoint, changing a payload, defining server-side validation, deciding where a permission check belongs, or diagnosing a handler that succeeds for the wrong caller.
---

# Backend Contracts

The contract is what callers can rely on. Decide it before writing the handler; changing it later is a migration.

## Initial Response

Before editing, answer in one line each: who calls this, what shape goes in, what shape comes out, what happens on failure, and who may call it. If any of those is unknown, the contract is not ready — state the assumption you are making and ask only the one that would change the design.

## The five boundaries

Every request crosses five boundaries in this order. Each has an owner and a failure mode.

1. **Transport** — method, path, content type, size limit. Failure: 4xx before any business logic runs.
2. **Shape** — required fields, types, ranges, enums. Validate once at the edge, then trust the parsed value downstream. Re-validating the same field in three layers means the boundary is misplaced.
3. **Identity and permission** — who is calling, and may they act on *this* object. Authorize against the resolved resource, never against a path parameter alone.
4. **Business rule** — invariants that the database alone cannot express.
5. **Persistence** — transaction scope, isolation, and what is retried.

## Error taxonomy

Use four classes and keep them distinct end to end:

- `invalid_input` — caller sent something structurally wrong. Never include internal details.
- `not_found` / `forbidden` — decide once whether unauthorized access to an existing object returns 404 or 403, and apply it everywhere. Leaking existence through distinct codes is a real information leak.
- `conflict` — state changed underneath the caller (version mismatch, duplicate key).
- `unavailable` — dependency down or timed out. This is the only class worth retrying.

Every error needs an actionable message and a stable machine code. A handler that catches everything and returns 200 with `{ok:false}` moves the failure out of the contract, where callers stop handling it.

## Idempotency and retries

Any endpoint that can be retried by a client, a queue, or a proxy must be safe to retry. Either:

- the operation is naturally idempotent (set a value), or
- the caller supplies an idempotency key stored with the result, so a replay returns the first outcome rather than repeating the side effect.

Test it by issuing the same request twice and checking that the second call does not double-write, double-charge, or double-send.

## Validation placement

Validate at the edge for shape; validate in the domain for invariants. Do not rely on the database alone for user-facing rules — the constraint will be hit as a raw driver error. Do not duplicate the edge validation inside every internal caller; if internal callers can pass bad data, that is a missing domain check, not a reason for a third copy.

## Transactions

One transaction per business operation. Anything with an external side effect (email, payment, file write) belongs outside the transaction, with an outbox or an explicit compensation step. A transaction held open across a network call is a lock held across a network call.

## Review checklist

- Can an unauthenticated caller reach it? Where is that proven?
- Can caller A act on caller B's object? Which line resolves ownership?
- What does a duplicate submission do?
- What does the client see when the database is down?
- Is the response shape additive-only relative to the last release, or is this a breaking change?
- Are list endpoints paginated and bounded by a server-side maximum?
