---
name: security-baseline
description: Apply and review a baseline security posture — authentication, session handling, authorization checks, input validation, secrets, dependency risk, and the OWASP-style failure classes that matter most. Use when adding login, permissions, file upload, user-supplied HTML, a new dependency, or when reviewing a change for security holes before release.
---

# Security Baseline

Security is a set of boundaries that hold under adversarial input. Review by tracing where untrusted data can reach, not by checking boxes.

## Initial Response

Name the trust boundary you are changing: what untrusted input enters, and which asset it can reach if the boundary fails. If you cannot name both, there is no threat model for the change yet.

## Data flow first

For each entry point — form, query parameter, header, cookie, uploaded file, webhook body — trace the value to every sink it reaches: database query, shell command, file path, HTML output, redirect target, outbound request. Each entry-to-sink pair is where a class of vulnerability lives. This trace finds real problems faster than any checklist.

## The classes that account for most incidents

- **Injection** — SQL, command, template, LDAP. Never build queries or commands by string concatenation with user input. Use parameterized queries and argument arrays.
- **Broken access control** — the client checks a permission but the server does not, or the server checks whether the user is logged in but not whether they may act on *this* object. Every object access re-authorizes against the owner. Never trust a client-supplied role or id.
- **Authentication and session** — passwords hashed with a slow, salted algorithm (bcrypt, scrypt, argon2); session tokens high-entropy, httpOnly, secure, sameSite; logout invalidates server-side; password reset tokens single-use and short-lived.
- **XSS** — escape on output, in the right context (HTML, attribute, URL, script). Sanitize only when storing user HTML, and use a maintained sanitizer. Do not build HTML by string concatenation.
- **SSRF and redirects** — any URL the server fetches from user input needs an allowlist of hosts and schemes.
- **Path traversal** — resolve and check containment before opening a user-supplied path.
- **Sensitive data exposure** — no secrets or PII in logs, error messages, URLs or client bundles. Redact at the log call, not in a later grep.
- **CSRF** — state-changing requests require a token or a strict sameSite cookie.
- **Insecure defaults** — debug mode, stack traces, permissive CORS (`*` with credentials), directory listing, default credentials.

## Secrets

- Never in source, tests, fixtures, commit history, logs or error output.
- Load from environment or a secret store; fail fast at startup if a required secret is missing.
- Different secrets per environment; rotating one does not touch the others.
- If a secret has been committed, treat it as compromised: rotate first, then remove from history.

## Permissions

Enforce on the server. The UI hides a button; it never grants permission. Authorization belongs at the operation boundary and re-checks ownership of the specific record. Test with a second account that should be denied — a missing check is invisible when you only test the happy path.

## Dependencies

Before adding one, ask what it does that the platform cannot, who maintains it, and how widely it is used. Pin versions, commit the lockfile, and review what a new major version pulls in. An unused dependency is attack surface with no benefit.

## Review checklist

- Does every route have an explicit authorization decision, including admin-only ones?
- Is every database access parameterized?
- Could any user-supplied value reach a file path, shell, or outbound URL?
- Are secrets absent from the repo and from logs?
- Does a logged-out session actually stop working server-side?
- Is there a second-account test that proves a denied action is denied?
