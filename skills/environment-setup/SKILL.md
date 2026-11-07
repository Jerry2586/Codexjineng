---
name: environment-setup
description: Diagnose and configure the local or server runtime for a project — runtimes, package managers, ports, environment variables, services, containers, proxies and certificates. Use when the app will not start, a dependency will not install, a port is occupied, a service is unreachable, or when preparing an environment for the first time.
---

# Environment Setup

Most "the code is broken" reports are environment faults. Separate them before touching application code.

## Initial Response

Classify the failure before fixing it. For each symptom, decide which of these it is: a skill/tool limitation, a project configuration error, an environment/runtime fault, or an application defect. Fix the real cause; do not patch the app to work around a broken environment.

## Check in this order

1. **Runtime** — required version present and actually used (`node --version`, `python --version`). Multiple installs on PATH are a common cause of "works in one terminal".
2. **Package manager and lockfile** — is the lockfile committed and consistent with the manifest? A missing lockfile means every install picks different versions.
3. **Dependencies** — install logs, native build failures, peer conflicts. Read the first error, not the last.
4. **Environment variables** — required keys present, no trailing whitespace, correct environment (dev vs prod). Fail fast at startup and name the missing key; silent defaults hide misconfiguration.
5. **Ports and processes** — is the port already bound by an old process of this project? Kill only the process belonging to this project; never kill by port number blindly.
6. **Services** — database, cache, queue reachable with the configured connection string, not with a different one from memory.
7. **Network path** — proxy, hosts file, DNS, TLS certificate for the target host.
8. **Build artifacts** — stale caches from a different version. Clear the specific cache; do not delete unrelated state.

## Rules

- Keep one source of truth for configuration: a committed example file (`.env.example`) listing every required key with a safe placeholder, and the real values only in the environment.
- Ports belong to the project, not the machine: document the port, and fail with a clear message if it is taken.
- Containers: reproduce with the image the project actually ships. "Works on my host" is not verified.
- Certificate errors are environment facts, not bugs to disable verification for. Fix the trust store or the certificate.
- Do not solve an environment problem by deleting the database, the volumes, the uploads, the config or the logs.

## Debugging method

Reproduce once with the exact command from the project's docs. Then bisect: comment out the plugin, run the dependency alone, hit the endpoint with the smallest possible client. Each step must change one variable. Record what you ran and what came back — a diagnosis without the command is a guess.

## Evidence

Save the actual command output (redacted) for each check you claim passed. "The environment is fine" is not evidence; the version string and the successful health check are.

## Review checklist

- Can a new contributor start the project from the committed docs alone?
- Are all required environment keys documented in one example file?
- Is every port documented and collision-checked?
- Are certificate and proxy settings explicit rather than disabled?
