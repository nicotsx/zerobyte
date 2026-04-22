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
