# Security Policy

Thank you for helping keep Zerobyte and its users secure.

Zerobyte is currently in `0.x`, and releases may include breaking changes between versions. For that reason, security fixes are only guaranteed for the most recent stable release line.

## Supported Versions

| Version                                       | Supported          |
| --------------------------------------------- | ------------------ |
| Latest stable `0.x` release                   | :white_check_mark: |
| Older stable `0.x` releases                   | :x:                |
| Pre-release builds (`-alpha`, `-beta`, `-rc`) | :x:                |
| Development snapshots from `main`             | :x:                |

Security fixes are generally released in the latest stable version only. If you are running an older release, you may be asked to upgrade before a fix is provided.

## Reporting a Vulnerability

Please do **not** report security vulnerabilities through public GitHub issues, discussions, or pull requests.

Use one of these private channels instead:

1. Preferred: GitHub private vulnerability reporting
   https://github.com/nicotsx/zerobyte/security/advisories/new
2. Alternative: contact the maintainer directly by email if an address is listed in the repository or GitHub profile

When reporting, include as much of the following as you can:

- affected Zerobyte version
- deployment details, including whether you are using Docker, reverse proxies, or exposed ports
- clear reproduction steps or a proof of concept
- impact assessment and what an attacker could do
- any relevant logs, screenshots, or configuration excerpts with secrets removed

### What to expect

- We aim to acknowledge new reports within 7 days.
- We aim to provide status updates at least every 7 days while the report is being investigated.
- If the report is accepted, we will work on a fix, coordinate disclosure, and publish a security advisory when appropriate.
- If the report is declined, out of scope, or cannot be reproduced, we will explain why when possible.

Please avoid public disclosure until a fix has been released and maintainers have had reasonable time to notify users.

## Trust model baseline

Zerobyte is a self-hosted operator tool. Treat any authenticated user as a trusted machine/operator user with intentional access to:

- Browse/select host directories for volumes
- Configure local, network, and cloud storage backends
- Trigger mounts/unmounts, backups, restores, and Restic maintenance
- Read/write files through intended backup/restore workflows
- Access repository/volume metadata needed to operate backups

Do **not** report these as vulnerabilities by themselves:

- Authenticated host filesystem browsing
- Local directory volume pointing to broad host paths
- Backing up arbitrary readable host paths
- Restoring snapshots to arbitrary writable host paths
- Authenticated Restic/mount/rclone execution through intended UI flows
- Information disclosure to authenticated operators about filesystem paths or backend errors

Only report issues when they violate this trust model, for example:

- Unauthenticated access to operator features
- CSRF/cross-origin abuse causing a trusted operator’s browser to perform actions
- Shell/command injection beyond intended argument-based execution
- Path traversal that escapes a deliberately configured root/volume/repository boundary
- Secret leakage to logs, unauthenticated users, or non-operator contexts
- Cross-organization data access despite authenticated trust
- Privilege bypass between global admin/org admin/member where the product explicitly distinguishes roles
- Unsafe dev-only features enabled without the documented gate
- Vulnerabilities in parsing untrusted external data from repositories/backends/notifications
- Persistence corruption, data loss, or workflow bypass not intended by operator actions
