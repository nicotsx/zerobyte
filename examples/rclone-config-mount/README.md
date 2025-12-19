# Mount an rclone config (for rclone repositories)

This example shows how to make an existing rclone configuration available inside the Zerobyte container.

Use this if you want to use **rclone** as a repository backend (Dropbox/Google Drive/OneDrive/etc.).

## Prerequisites

- Docker + Docker Compose
- An existing rclone config directory on the Docker host

If you don't have one yet:

```bash
rclone config
```

## Setup

1. Copy the env file:

```bash
cp .env.example .env
```

1. Edit `.env` and set `RCLONE_CONFIG_DIR` to the absolute path of your host rclone config directory.

1. Start the stack:

```bash
docker compose up -d
```

## Access

- UI/API: `http://<host>:4096`

## Notes

- This setup does not require `SYS_ADMIN` or `/dev/fuse`.
- The rclone config is mounted read-only into `/root/.config/rclone`.
