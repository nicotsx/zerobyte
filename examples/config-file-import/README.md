# Config file import (Infrastructure as Code)

Zerobyte supports **config file import** on startup.
This lets you pre-configure volumes, repositories, backup schedules, notification destinations, and an initial user.

This example includes:

- a runnable `docker-compose.yml`
- a comprehensive `zerobyte.config.example.json` template (trim it down to what you actually use)
- `.env.example` showing how to inject secrets via environment variables

## Prerequisites

- Docker + Docker Compose

This example includes `SYS_ADMIN` and `/dev/fuse` because it’s compatible with remote volume mounts (SMB/NFS/WebDAV).

## Setup

1. Copy the env file:

```bash
cp .env.example .env
```

2. Create a local directory to mount as a sample volume:

```bash
mkdir -p mydata
```

3. Create a working config file (copy the example template):

```bash
cp zerobyte.config.example.json zerobyte.config.json
```

This is the recommended workflow for quick testing: if you don't have your own JSON config yet, start from the template.

4. Review/edit `zerobyte.config.json`.

  The example template is intentionally "kitchen-sink" (lots of volume/repository/notification types) so you can copy what you need.
  Delete the entries you don't plan to use, and keep only the ones you have credentials/mounts for.

5. Start Zerobyte:

```bash
docker compose up -d
```

6. Access the UI at `http://localhost:4096`.

## Notes

### Import methods

Zerobyte supports two ways to import configuration:

#### Method 1: Environment variable (automatic on startup)

Set `ZEROBYTE_CONFIG_IMPORT=true` and the import runs automatically when the container starts:

```yaml
services:
  zerobyte:
    environment:
      - ZEROBYTE_CONFIG_IMPORT=true
      - ZEROBYTE_CONFIG_PATH=/app/zerobyte.config.json  # optional, this is the default
```

This is ideal for automated deployments where you want `docker compose up` to fully configure the instance.

#### Method 2: CLI command (manual control)

Run the import explicitly using the CLI:

```bash
# Import from a mounted config file (starts a new temporary container)
docker compose run --rm zerobyte bun run cli import-config --config /app/zerobyte.config.json

# Import from a mounted config file into an already-running container
docker compose exec zerobyte bun run cli import-config --config /app/zerobyte.config.json

# Import from stdin (into running container)
cat zerobyte.config.json | docker compose exec -T zerobyte bun run cli import-config --stdin

# Import from stdin in PowerShell (into running container)
Get-Content zerobyte.config.json | docker compose exec -T zerobyte bun run cli import-config --stdin

# Validate config without importing (dry run)
docker compose run --rm zerobyte bun run cli import-config --config /app/zerobyte.config.json --dry-run
```

The `--stdin` option is useful when you don't want to mount the config file - just pipe it directly.

This is useful when you want to:
- See import output directly in your terminal
- Re-run import after fixing issues
- Test config files before applying them
- Import without modifying your docker-compose.yml

### Secrets via env vars

Zerobyte supports **two different mechanisms** that are easy to confuse:

1. **Config import interpolation** (this example)
2. **Secret placeholders** (`env://...` and `file://...`)

#### 1) Config import interpolation: `${VAR_NAME}`

During config import, any string value in the JSON can reference an environment variable using `${VAR_NAME}`.

Example:

```json
{
  "recoveryKey": "${RECOVERY_KEY}",
  "repositories": [
    {
      "name": "s3-repo",
      "config": {
        "backend": "s3",
        "accessKeyId": "${ACCESS_KEY_ID}",
        "secretAccessKey": "${SECRET_ACCESS_KEY}"
      }
    }
  ]
}
```

Important properties of `${...}` interpolation:

- It runs **only during import**.
- Values are **resolved before** they are written to the database (meaning the actual secret ends up in the DB for fields that are stored as secrets).
- Because it reads `process.env`, Docker Compose must inject those variables into the container.

This example uses:

- `env_file: .env`

So to make `${VAR_NAME}` work, put the variables in `.env` (or otherwise provide them in the container environment).

#### 2) Secret placeholders: `env://...` and `file://...`

Separately from config import, Zerobyte supports **secret placeholders** for *some sensitive fields*.
These placeholders are stored **as-is** in the database (the raw secret is not stored) and resolved at runtime.

Supported formats:

- `env://VAR_NAME` → reads `process.env.VAR_NAME` at runtime
- `file://secret_name` → reads `/run/secrets/secret_name` (Docker secrets)

This is useful when you want to keep secrets out of the database and rotate them without editing Zerobyte’s stored config.

See the runnable example:

- [examples/secrets-placeholders/README.md](../secrets-placeholders/README.md)

### Config file behavior (create-only)

The config file is applied on startup using a **create-only** approach:

- Resources defined in the config are only created if they don't already exist in the database
- Existing resources with the same name are **not overwritten** (a warning is logged and the config entry is skipped)
- Changes made via the UI are preserved across container restarts
- To update a resource from config, either modify it via the UI or delete it first

This makes the config file better suited as "initial setup" than as a "desired state sync".

---

## Config structure reference

This example is intended to be the primary, copy/paste-friendly reference for config import.

### `zerobyte.config.json` structure

```json
{
  "recoveryKey": "${RECOVERY_KEY}",
  "volumes": [
    "..."
  ],
  "repositories": [
    "..."
  ],
  "backupSchedules": [
    "..."
  ],
  "notificationDestinations": [
    "..."
  ],
  "users": [
    "..."
  ]
}
```

### Volume types

#### Local directory

```json
{
  "name": "local-volume",
  "config": {
    "backend": "directory",
    "path": "/mydata",
    "readOnly": true
  }
}
```

#### NFS

```json
{
  "name": "nfs-volume",
  "config": {
    "backend": "nfs",
    "server": "nfs.example.com",
    "exportPath": "/data",
    "port": 2049,
    "version": "4",
    "readOnly": false
  }
}
```

#### SMB

```json
{
  "name": "smb-volume",
  "config": {
    "backend": "smb",
    "server": "smb.example.com",
    "share": "shared",
    "username": "user",
    "password": "${SMB_PASSWORD}",
    "vers": "3.0",
    "domain": "WORKGROUP",
    "port": 445,
    "readOnly": false
  }
}
```

#### WebDAV

```json
{
  "name": "webdav-volume",
  "config": {
    "backend": "webdav",
    "server": "webdav.example.com",
    "path": "/remote.php/webdav",
    "username": "user",
    "password": "${WEBDAV_PASSWORD}",
    "port": 80,
    "readOnly": false,
    "ssl": true
  }
}
```

### Repository types

#### Local

```json
{
  "name": "local-repo",
  "config": {
    "backend": "local",
    "path": "/var/lib/zerobyte/repositories"
  },
  "compressionMode": "auto"
}
```

Note for importing existing local repositories (migration):

- include `config.name` and set `config.isExistingRepository: true`
- the actual restic repo is stored at `{path}/{name}`

```json
{
  "name": "my-local-repo",
  "config": {
    "backend": "local",
    "path": "/var/lib/zerobyte/repositories",
    "name": "abc123",
    "isExistingRepository": true
  }
}
```

#### S3-compatible

```json
{
  "name": "backup-repo",
  "config": {
    "backend": "s3",
    "bucket": "mybucket",
    "accessKeyId": "${ACCESS_KEY_ID}",
    "secretAccessKey": "${SECRET_ACCESS_KEY}"
  },
  "compressionMode": "auto"
}
```

#### Google Cloud Storage

```json
{
  "name": "gcs-repo",
  "config": {
    "backend": "gcs",
    "bucket": "mybucket",
    "projectId": "my-gcp-project",
    "credentialsJson": "${GCS_CREDENTIALS}"
  }
}
```

#### Azure Blob Storage

```json
{
  "name": "azure-repo",
  "config": {
    "backend": "azure",
    "container": "mycontainer",
    "accountName": "myaccount",
    "accountKey": "${AZURE_KEY}"
  }
}
```

### Backup schedules

```json
{
  "name": "local-volume-local-repo",
  "volume": "local-volume",
  "repository": "local-repo",
  "cronExpression": "0 2 * * *",
  "retentionPolicy": { "keepLast": 7, "keepDaily": 7 },
  "includePatterns": ["important-folder"],
  "excludePatterns": ["*.tmp", "*.log"],
  "excludeIfPresent": [".nobackup"],
  "oneFileSystem": true,
  "enabled": true,
  "notifications": ["slack-alerts", "email-admin"],
  "mirrors": [
    { "repository": "s3-repo" },
    { "repository": "lo2" }
  ]
}
```

**Fields:**

- `name`: Unique schedule name
- `volume`: Name of the source volume
- `repository`: Name of the primary destination repository
- `cronExpression`: Cron string for schedule timing
- `retentionPolicy`: Object with retention rules (`keepLast`, `keepHourly`, `keepDaily`, `keepWeekly`, `keepMonthly`, `keepYearly`, `keepWithinDuration`)
- `includePatterns` / `excludePatterns`: Arrays of file patterns
- `excludeIfPresent`: Array of filenames; if any of these files exist in a directory, that directory is excluded (e.g., `[".nobackup"]`)
- `oneFileSystem`: Boolean; if `true`, restic won't cross filesystem boundaries (useful when backing up `/` to avoid traversing into mounted volumes)
- `enabled`: Boolean
- `notifications`: Array of notification destination names or detailed objects (see below)
- `mirrors`: Array of mirror repositories (see below)

#### Notifications (detailed)

`notifications` can be strings (destination names) or objects with fine-grained control:

```json
[
  {
    "name": "slack-alerts",
    "notifyOnStart": false,
    "notifyOnSuccess": true,
    "notifyOnWarning": true,
    "notifyOnFailure": true
  }
]
```

#### Mirrors

Mirrors let you automatically copy snapshots to additional repositories after each backup.
Each mirror references a repository by name:

```json
"mirrors": [
  { "repository": "s3-repo" },
  { "repository": "lo2", "enabled": false }
]
```

### User setup (automated)

Zerobyte currently supports a **single user**.
If multiple entries are provided in `users[]`, only the first one will be applied.

New instance:

```json
{
  "recoveryKey": "${RECOVERY_KEY}",
  "users": [
    {
      "username": "my-user",
      "password": "${ADMIN_PASSWORD}"
    }
  ]
}
```

Migration:

```json
{
  "recoveryKey": "${RECOVERY_KEY}",
  "users": [
    {
      "username": "my-user",
      "passwordHash": "$argon2id$v=19$m=19456,t=2,p=1$..."
    }
  ]
}
```

Use either `password` OR `passwordHash`, not both.

### Recovery key

The recovery key is a 64-character hex string that serves two critical purposes:

1. Restic repository password (encrypts your backup data)
2. Database encryption key (encrypts credentials stored in Zerobyte)

Generating a recovery key ahead of time:

```bash
# Using OpenSSL (Linux/macOS)
openssl rand -hex 32

# Using Python
python3 -c "import secrets; print(secrets.token_hex(32))"

# Using Docker (prints the key, container is removed)
docker run --rm python:3.12-alpine sh -lc 'echo "Key is on the next line:"; python -c "import secrets; print(secrets.token_hex(32))"'
```
