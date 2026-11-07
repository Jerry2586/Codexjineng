---
name: api-integration
description: Integrate and verify third-party or internal APIs against real responses — authentication, request shape, pagination, rate limits, timeouts, retries and failure handling. Use when connecting a new external service, debugging an integration that returns errors or empty data, adding a webhook, or replacing a guessed endpoint with the real one.
---

# API Integration

Never write an integration from a guess. The contract comes from a real response, captured and kept as evidence.

## Initial Response

State which source proves the contract: official docs with a version, the service's own server code, a captured request/response pair, or a live sandbox call. "The name suggests" is not a source.

## Integration order

Work in this order and do not skip ahead:

1. **Prove reachability.** One curl/fetch to a known endpoint with the real base URL. Confirm DNS, TLS, proxy and auth reach the service at all.
2. **Prove authentication.** Authenticate with the least-privileged credential available (sandbox key, test account). Record which header or query carries it.
3. **Prove one read.** Fetch a single known object. Save the response shape — field names, types, nullability — as a redacted fixture.
4. **Prove one write.** Send the smallest possible valid write to a test scope. Confirm it by reading it back, not by trusting the response code alone.
5. **Prove the failure paths.** Expired credential, invalid input, rate limit, timeout, upstream 5xx. Each needs a defined behaviour, not an unhandled throw.
6. **Then build the rest**, one endpoint at a time, each with the same verification.

## What the contract must record

- Base URL and environment (sandbox vs production) — never mix them in one config key.
- Auth scheme, token lifetime, and refresh behaviour.
- Required and optional parameters, with types and allowed values.
- Success shape, including which fields can be absent or null.
- Error shape and which status codes the client must handle.
- Pagination style (cursor, offset, link header) and the page size limit.
- Rate limits and the back-off behaviour the service documents.

## Failure handling

- Every outbound call has a timeout. A call with no timeout is an outage the upstream can trigger at will.
- Retry only idempotent or keyed operations, only on transient classes (timeout, 429, 5xx), with exponential back-off and a cap. Never retry a validation error.
- Distinguish "upstream is down" from "our request is wrong" in logs and in the error surfaced to the user. Conflating them sends the wrong person to fix it.
- Webhooks: verify the signature before parsing, make handlers idempotent by event id, and acknowledge quickly while processing asynchronously.

## Secrets

Credentials live in environment or a secret store, never in source, tests, fixtures or logs. Redact headers and tokens from any captured evidence before saving it. Use sandbox credentials throughout development; production keys only at the deploy step and only with explicit authorization.

## Verification evidence

Save a redacted record of each proven step under the project's evidence directory: the request shape, the response shape, and the observed status. A markdown note saying "integration works" is not evidence.

## Review checklist

- Is every credential sandbox-scoped, and is the production key absent from the repo?
- Does every outbound call have a timeout and a bounded retry policy?
- Is the success path confirmed by a read-back, not only by a 200?
- Are rate-limit and auth-expiry paths handled?
- Can a caller tell a bad request from a broken upstream?
