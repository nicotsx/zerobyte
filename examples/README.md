# Examples

This folder contains runnable, copy/paste-friendly examples for running Zerobyte in different setups.

## Table of contents

### Basic usage

- [Basic Docker Compose](basic-docker-compose/README.md) — standard deployment with remote mount support (includes `SYS_ADMIN` + `/dev/fuse`).
- [Simplified Docker Compose (no remote mounts)](simplified-docker-compose/README.md) — reduced-privilege deployment (no `SYS_ADMIN`, no `/dev/fuse`).
- [Bind-mount a local directory](directory-bind-mount/README.md) — back up a host folder by mounting it into the container.
- [Mount an rclone config](rclone-config-mount/README.md) — use rclone-based repository backends by mounting your rclone config.
- [Provisioned repositories and volumes](provisioned-resources/README.md) — operator-managed provisioning with env/file references kept in a mounted JSON file.

### Advanced setups

- [Tailscale sidecar](tailscale-sidecar/README.md) — run Zerobyte behind a Tailscale sidecar using shared networking.
