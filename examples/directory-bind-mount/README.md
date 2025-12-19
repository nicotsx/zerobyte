# Bind-mount a local directory

This example shows how to back up a host directory by bind-mounting it into the Zerobyte container.

It uses the simplified setup (no remote mounts).

## Prerequisites

- Docker + Docker Compose

## Setup

1. Copy the env file:

```bash
cp .env.example .env
```

1. Edit `.env` and set `HOST_DATA_DIR` to the directory you want to back up.

1. Start the stack:

```bash
docker compose up -d
```

## Use in Zerobyte

- Create a new volume of type **Directory**
- Select the mounted path shown in the compose file: `/mydata`

## Access

- UI/API: `http://<host>:4096`
