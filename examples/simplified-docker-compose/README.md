# Simplified Docker Compose (no remote mounts)

A reduced-privilege setup for Zerobyte when you do **not** need to mount NFS/SMB/WebDAV from inside the container.

## Prerequisites

- Docker + Docker Compose

## Setup

```bash
cp .env.example .env
docker compose up -d
```

## Access

- UI/API: `http://<host>:4096`

## Trade-offs

- ✅ No `SYS_ADMIN`
- ✅ No `/dev/fuse`
- ✅ Still supports all repository backends (local, S3, GCS, Azure, rclone)
- ❌ Cannot mount remote shares from inside Zerobyte
