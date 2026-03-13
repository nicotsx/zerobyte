# Provisioned repositories and volumes

This example shows how to keep operator-managed repositories and volumes in a mounted JSON file instead of creating them through the UI.

At startup, Zerobyte reads the provisioning file, resolves any `env://...` or `file://...` references, encrypts the resolved secrets into the database, and syncs the resources into the normal repositories and volumes lists as managed entries.

## Why this model

- Secret references stay in deployment-time config instead of the UI.
- Provisioned repositories and volumes show up in the normal UI and API.
- Secret rotation is just an env/secret update plus a restart.

## What this example includes

- `docker-compose.yml` mounts a provisioning file and a Docker secret.
- `.env.example` provides the environment variables used by `env://...` references.
- `provisioning.example.json` provisions one S3 repository and one WebDAV volume.
- `secrets/aws_secret_access_key.example` shows the file consumed by `file://aws_secret_access_key`.

## Prerequisites

- Docker + Docker Compose
- An existing Zerobyte organization ID (found in the UI under Settings > Organization)
- An S3-compatible repository target and a WebDAV share, or your own equivalent values

If this is a brand-new Zerobyte instance, finish first-run setup first so you have a real organization ID, then enable provisioning and restart the container.

## Setup

1. Copy the example files:

```bash
cp .env.example .env
cp provisioning.example.json provisioning.json
cp secrets/aws_secret_access_key.example secrets/aws_secret_access_key
```

2. Edit `.env`:

- Set `APP_SECRET` to a real secret, for example `openssl rand -hex 32`
- Set `ZEROBYTE_AWS_ACCESS_KEY_ID`
- Set `ZEROBYTE_WEBDAV_PASSWORD`
- Adjust `BASE_URL` and `TZ` if needed

3. Edit `provisioning.json`:

- Replace `organizationId` with your existing Zerobyte organization ID
- Update the S3 endpoint/bucket values
- Update the WebDAV server, path, and username

4. Edit `secrets/aws_secret_access_key` and replace the placeholder value with the real secret access key.

5. Start the stack:

```bash
docker compose up -d
```

## How secret references work

- `env://ZEROBYTE_AWS_ACCESS_KEY_ID` reads from a container environment variable.
- `env://ZEROBYTE_WEBDAV_PASSWORD` reads from a container environment variable.
- `file://aws_secret_access_key` reads `/run/secrets/aws_secret_access_key` inside the container.
- The resolved values are encrypted before Zerobyte stores them in the database.

`file://...` references are always resolved from `/run/secrets` and must be a single filename, not a nested path.

## Access

- UI/API: `http://<host>:4096`

## What you'll see in Zerobyte

- `AWS Production Backups` appears in the repositories list as a managed repository.
- `Team A WebDAV` appears in the volumes list as a managed volume.
- Changes to `provisioning.json`, `.env`, or mounted secret files apply on the next container restart.

## Rotating or removing provisioned resources

- Rotate an env-based secret: update `.env`, then restart Zerobyte.
- Rotate a file-based secret: update `secrets/aws_secret_access_key`, then restart Zerobyte.
- Remove a resource: add `delete: true`, then restart Zerobyte.

## Notes

- This example keeps `SYS_ADMIN` and `/dev/fuse` enabled because the sample volume uses WebDAV.
- Each provisioned entry must reference an existing `organizationId`.
- Each entry includes both a top-level `backend` and the matching `config.backend`.
