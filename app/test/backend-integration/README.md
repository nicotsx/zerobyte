# Backend Integration

This runner executes isolated source-level integration tests for Zerobyte volume backends and repository backends inside a Docker container that shares the same runtime tooling as the main image.

## What it verifies

For each scenario the runner will:

1. Mount the configured volume backend into an isolated temp workspace.
2. Read fixture files directly from the mounted filesystem.
3. Verify mounted file ownership and permission bits.
4. Run a restic backup directly against the configured repository backend.
5. Inspect the created snapshot with `restic ls` and verify snapshot metadata.
6. Restore the snapshot into an isolated temp directory.
7. Verify restored content, ownership, and permission bits.
8. Unmount and clean up local test artifacts.

## Bootstrap a Debian target

This folder includes `setup-target.sh`, which connects to a VM host and configures:

- NFS export at `/srv/zerobyte-backend-integration/fixtures`
- Samba share `//<host>/zerobyte-backend-integration`
- WebDAV endpoint at `http://<host>/zerobyte-backend-integration`
- SFTP access for both fixture reads and a reusable restic repository
- A generated local keypair, `known_hosts`, password files, and a ready-to-run config under `artifacts/192.168.2.41/`
