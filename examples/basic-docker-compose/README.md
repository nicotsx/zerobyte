# Basic Docker Compose

Minimal "standard" deployment for Zerobyte.

This setup enables remote mount backends (NFS/SMB/WebDAV) from inside the container by granting the required capability and FUSE device.

## Prerequisites

- Docker + Docker Compose

## Setup

```bash
cp .env.example .env
docker compose up -d
```

## Access

- UI/API: `http://<host>:4096`

## Notes

- This example uses `cap_add: SYS_ADMIN` and `/dev/fuse` to support mounting remote volumes.
- Do not place `/var/lib/zerobyte` on a network share.
