---
name: deployment-release
description: Prepare and verify a release or deployment — versioning, build artifacts, CI gates, environment configuration, backup, health checks, rollout and rollback. Use when cutting a version, packaging an artifact, deploying to a server or store, or verifying that a deployed release actually works in its real environment.
---

# Deployment And Release

A release is finished when the deployed artifact is verified in its real environment, not when the pipeline turns green.

## Initial Response

State the release route before doing anything: where the artifact goes, how it is versioned, who or what deploys it, and how it is rolled back. If the project already documents this, follow it; do not invent a second route.

## Order that must not be reordered

1. **Version** — one number in one place, referenced by the app, the package, the tag and the changelog. Bump by the project's own rule; do not guess a semver policy the project has not adopted.
2. **Tests** — the agreed suite passes on the exact commit being released. A red or unrun test stops here; it is not a note to fix later.
3. **Build** — reproducible from the committed lockfile, producing the artifact that will actually ship.
4. **Pre-deploy** — backup, migration plan, rollback trigger conditions. For anything destructive, confirm separately with the person who owns the data.
5. **Deploy** — to the least risky environment first when one exists.
6. **Verify** — process or container healthy, proxy and certificate correct, database reachable, key page and core endpoint responding, logs free of startup errors, version string matching the release.
7. **Acceptance** — a real user path exercised in the real environment. Deployed is not the same as accepted.

## Configuration per environment

Configuration differs per environment; code does not. Every environment key is provided by that environment, with the same names. A release that needs a code change to point at production is a configuration leak.

## Rollback

Before deploying, answer: how is this version undone if it misbehaves, and does rolling back lose data?

- Additive migrations roll back; destructive ones may not.
- Keep the previous artifact available until the new one is verified.
- A rollback that requires a forward fix is not a rollback; say so before deploying.

## Version discipline

- Tags are immutable. Never move or force-push a released tag.
- The release notes describe what changed for the user, not the commit list.
- Every artifact records which commit built it.

## Evidence

Record for the release: commit, version, test result, build result, artifact hash, deploy target, health check output, and acceptance result. A release with missing evidence is a release with unknown risk.

## Failure handling

When a gate fails, stop and fix. Never ship a known-broken build to make a schedule, and never hide a failure by widening a test or skipping a check. If the failure is environmental, say which environment and what was verified instead, and mark the release pending rather than complete.

## Review checklist

- Does one version number flow through app, package, tag and changelog?
- Did the full suite pass on this exact commit?
- Is there a backup and a rollback path, and has the rollback been described?
- After deploy, was the version string on the running system compared to the released one?
- Was the user path exercised in the real environment, or only in staging?
