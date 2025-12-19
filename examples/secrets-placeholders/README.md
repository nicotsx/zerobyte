# Secret placeholders (env:// and file://) + Docker secrets

Zerobyte supports **secret placeholders** in many configuration fields (repositories, volumes, notifications).
Instead of storing raw secrets in the database, you can store a reference that gets resolved at runtime.

Supported formats:

- `env://VAR_NAME` → reads `process.env.VAR_NAME`
- `file://name` → reads `/run/secrets/name` (Docker Compose / Docker secrets)

This example shows how to run Zerobyte with:

- an environment variable you can reference via `env://...`
- a Docker secret you can reference via `file://...`

## Prerequisites

- Docker + Docker Compose

This example includes `SYS_ADMIN` and `/dev/fuse` because it’s intended for SMB volumes (remote mounts).

## Setup

1. Copy the env file:

```bash
cp .env.example .env
```

1. Create a Docker secret file (this file is not meant to be committed):

```bash
printf "your-smb-password" > smb-password.txt
```

1. Start Zerobyte:

```bash
docker compose up -d
```

## Using placeholders in Zerobyte

You can now use the placeholders for example in these Zerobyte configuration fields:

| UI section | Type | Field | Example value |
| --- | --- | --- | --- |
| Volumes → Create volume | SMB | Password | `file://smb_password` or `env://ZEROBYTE_SMB_PASSWORD` |
| Volumes → Create volume | WebDAV | Password | `file://webdav_password` or `env://ZEROBYTE_WEBDAV_PASSWORD` |
| Repositories → Create repository | S3 | Secret access key | `file://aws_secret_access_key` or `env://AWS_SECRET_ACCESS_KEY` |
| Repositories → Create repository | SFTP | SSH Private key | `file://sftp_private_key` or `env://SFTP_PRIVATE_KEY` |
| Notifications → Create notification | Telegram | Bot token | `file://telegram_bot_token` or `env://TELEGRAM_BOT_TOKEN` |

Notes:

- Placeholder names used in these examples are arbitrary; you can choose any valid name.
- Placeholder names are case-sensitive.
- With `file://...`, the secret name must be a single path segment (no `/` or `\\`).
- You can still paste a raw secret, but placeholders can be considered safer and easier to rotate.
