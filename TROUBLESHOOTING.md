# Troubleshooting

If you encounter any issues while using Zerobyte, you can check the application logs for more information.
These logs can help you identify and resolve common problems; you should also check existing and closed issues on GitHub.
In case you need further assistance, feel free to open a new issue with detailed information about the problem you are facing and any relevant log entries.

> [!WARNING]
> Make sure to never share sensitive information such as passwords, access keys, or personal data in public issues so remove them from logs before posting.

Before troubleshooting, enable debug logging so the logs contain enough detail to diagnose issues.

```yaml
services:
  zerobyte:
    environment:
      - LOG_LEVEL=debug
```

After adding `LOG_LEVEL=debug`, restart Zerobyte and then collect logs.

To view the logs, run the command below:

```bash
# replace 'zerobyte' with your container name if different
docker logs -f zerobyte
```

---

## Table of Contents

- [Common Issues](#common-issues)
  - [Permission Denied Errors When Mounting Remote Shares](#permission-denied-errors-when-mounting-remote-shares)
  - [Security Levels for Mounting Remote Shares](#security-levels-for-mounting-remote-shares)
    - [Permission Errors with Remote Shares](#permission-errors-with-remote-shares)
    - [Container Cannot Perform Mounts](#container-cannot-perform-mounts)
    - [AppArmor-Enabled Systems (Ubuntu/Debian)](#apparmor-enabled-systems-ubuntudebian)
    - [Seccomp-Restricted Environments](#seccomp-restricted-environments)
    - [SELinux-Enabled Systems (CentOS/Fedora)](#selinux-enabled-systems-centosfedora)
    - [Still Getting Permission Errors After SYS_ADMIN](#still-getting-permission-errors-after-sys_admin)
- [FUSE Mount Failures](#fuse-mount-failures)
- [Rclone Issues](#rclone-issues)
  - [Test on Host First](#critical-test-on-host-first)
  - [Pre-flight Checklist](#pre-flight-checklist)
    - [Common Rclone Errors](#common-rclone-errors)
      - ["No Remotes Available" in Dropdown](#no-remotes-available-in-dropdown)
      - ["Failed to Create File System" Error](#failed-to-create-file-system-error)
      - [EACCES Errors](#eacces-errors)
      - [Rclone SFTP Repository Authentication Failures](#rclone-sftp-repository-authentication-failures)
  - [Rclone Volume Mount Issues](#rclone-volume-mount-issues)
    - [Prerequisites Check](#prerequisites-check)
    - [Common Mount Errors](#common-mount-errors)
  - [Still Having Issues?](#still-having-issues)

---

## Common Issues

### Permission Denied Errors When Mounting Remote Shares

Mounting remote filesystems (such as SMB/CIFS) requires kernel-level privileges. When Zerobyte attempts to perform mounts from inside a container, additional permissions may be required.

Ensure that:

- Remote share credentials are correct
- The host kernel supports the target filesystem (e.g. CIFS module is available)
- Docker is running in **rootful mode** (rootless Docker cannot perform kernel mounts)

In some environments, Linux security mechanisms such as AppArmor or seccomp may block mount-related operations even when the required capabilities are present.

---

### Security Levels for Mounting Remote Shares

Zerobyte supports multiple deployment models depending on your security requirements and environment.

---

#### Permission Errors with Remote Shares

**Problem:** You're getting permission errors when Zerobyte tries to mount remote shares (SMB/CIFS, NFS, etc.).

**Solution:** Mount remote shares **outside of Zerobyte** (on the host) and point Zerobyte to an already-mounted local path. This avoids container permission issues entirely.

**How to fix:**

1. Mount your remote share on the host first using `systemd`, `autofs`, or manual mount:

   ```bash
   sudo mount -t cifs //server/share /mnt/your-remote-share -o credentials=/path/to/creds
   ```

2. Then mount that local path into Zerobyte:

   ```yaml
   services:
     zerobyte:
       volumes:
         - /mnt/your-remote-share:/data
   ```

3. Restart the container:
   ```bash
   docker compose down && docker compose up -d
   ```

---

#### Container Cannot Perform Mounts

**Problem:** Zerobyte shows "Operation not permitted" errors when trying to mount remote shares directly.

**Solution:** Grant the `SYS_ADMIN` capability to allow the container to perform mount operations.

**Warning:** This grants significant privileges to the container and should only be used when necessary.

```yaml
services:
  zerobyte:
    cap_add:
      - SYS_ADMIN
```

> ⚠️ Granting `SYS_ADMIN` allows the container to perform mount operations and should be used only when strictly necessary.

---

#### AppArmor-Enabled Systems (Ubuntu/Debian)

On hosts using AppArmor, the default Docker profile (`docker-default`) may block mount operations even when `SYS_ADMIN` is present.

If mount operations fail with permission errors, you may need to disable AppArmor confinement for the container. Check first if AppArmor is enabled on your system and the profile of the container:

```bash
# check if AppArmor is enabled
sudo aa-status
# if next command returns 'docker-default', AppArmor is enabled on the container
docker inspect --format='{{.AppArmorProfile}}' zerobyte
```

If AppArmor is enabled, you can disable it for the Zerobyte container by adding the following to your `docker-compose.yml`:

```yaml
services:
  zerobyte:
    cap_add:
      - SYS_ADMIN
    security_opt:
      - apparmor:unconfined
```

---

#### Seccomp-Restricted Environments

Docker's default seccomp profile may block mount-related syscalls required by filesystem operations.

If mount operations continue to fail, you may need to disable seccomp filtering for the container:

```yaml
services:
  zerobyte:
    cap_add:
      - SYS_ADMIN
    security_opt:
      - seccomp:unconfined
```

---

#### SELinux-Enabled Systems (CentOS/Fedora)

On hosts using SELinux, you may need to adjust the security context to allow mount operations.
If mount operations fail with permission errors, you can try adding the following label:

```yaml
services:
  zerobyte:
    cap_add:
      - SYS_ADMIN
    security_opt:
      - label:type:container_runtime_t
```

or disable SELinux enforcement for the container:

```yaml
services:
  zerobyte:
    cap_add:
      - SYS_ADMIN
    security_opt:
      - label:disable
```

---

#### Still Getting Permission Errors After SYS_ADMIN

**Problem:** Mount operations still fail even with `SYS_ADMIN` capability.

**Solution (Last Resort):** Run the container in privileged mode. This disables most container isolation mechanisms and significantly increases the attack surface.

**Warning:** Only use this as a last resort for troubleshooting. Remove and switch to a more secure solution once you identify the actual issue.

```yaml
services:
  zerobyte:
    privileged: true
```

---

### FUSE Mount Failures

**Problem:** FUSE-based mounts (sshfs, rclone mount) are failing with device access errors.

**Cause:** Access to `/dev/fuse` is required for FUSE-based filesystems.

**Solution:** Ensure `/dev/fuse` is mounted into the container. This is **not required** for SMB/CIFS mounts.

````yaml
services:
  zerobyte:
    devices:
      - /dev/fuse:/dev/fuse

---

## Rclone Issues

### ⚠️ Critical: Test on Host First

**Before reporting any rclone-related issue, you MUST verify that rclone works correctly on your Docker host.**

Most rclone issues are due to misconfigured remotes, not Zerobyte bugs. Follow this checklist on your host machine:

```bash
# 1. List all configured remotes
rclone listremotes

# 2. Test listing a remote (replace 'myremote' with your remote name)
rclone lsd myremote:

# 3. Test reading from a remote
rclone ls myremote:path/to/test

# 4. For volume mounts: Test mounting on host first
mkdir -p /tmp/rclone-test
rclone mount myremote:path /tmp/rclone-test --daemon --vfs-cache-mode writes
ls /tmp/rclone-test
fusermount -u /tmp/rclone-test  # Unmount when done
````

**If these commands fail on your host, fix your rclone configuration before using Zerobyte.**

Common issues include:

- Expired OAuth tokens (run `rclone config` to re-authenticate)
- Incorrect credentials
- Missing permissions on cloud provider side
- Network/firewall issues

---

### Pre-flight Checklist

If you're experiencing rclone issues, verify all of the following:

- [ ] Rclone is installed and configured on the Docker **host**
- [ ] `rclone listremotes` shows your remote
- [ ] `rclone lsd remote:` successfully lists directories
- [ ] The rclone config directory is mounted into the container

---

### Common Rclone Errors

#### "No Remotes Available" in Dropdown

**Cause:** Zerobyte cannot find your rclone configuration file.

**Diagnosis:**

```bash
# Check which config file rclone will use inside the container
docker exec zerobyte sh -lc 'echo HOME=$HOME; rclone config file'
```

**Solutions:**

1. Ensure you've mounted your host's rclone config:

   ```yaml
   volumes:
     - ~/.config/rclone:/root/.config/rclone:ro
   ```

2. For non-root containers (e.g., TrueNAS), set the correct path:

   ```yaml
   environment:
     - RCLONE_CONFIG_DIR=/home/appuser/.config/rclone
   volumes:
     - ~/.config/rclone:/home/appuser/.config/rclone:ro
   ```

3. **Restart the container** after mounting the config:
   ```bash
   docker compose down
   docker compose up -d
   ```

#### "Failed to Create File System" Error

**Cause:** Authentication failure with the cloud provider.

**Solution:**

1. On your host, run: `rclone config`
2. Re-authenticate the remote (especially for OAuth providers like Google Drive, Dropbox, OneDrive)
3. Verify with: `rclone lsd remote:`
4. Restart the Zerobyte container

#### EACCES Errors

**Cause:** AppArmor or seccomp is blocking rclone execution.

**Solution:** Disable security profiles as described in:

- [AppArmor-enabled systems](#apparmor-enabled-systems-ubuntudebian)
- [Seccomp-restricted environments](#seccomp-restricted-environments)

#### Rclone SFTP Repository Authentication Failures

When creating an **rclone repository** that uses an **SFTP remote**, you may encounter authentication errors even though:

- The rclone config is mounted correctly
- The SFTP remote appears in the dropdown
- The same config works on the host

**The issue:** If your rclone SFTP remote uses `key_file` for SSH key authentication, the key file path in your rclone config points to a location on the **host** (e.g., `~/.ssh/id_rsa`). When rclone runs inside the container, it cannot access that path.

**Solutions:**

**Option 1: Mount your SSH keys (Recommended)**

Add your SSH directory to the container volumes:

```yaml
services:
  zerobyte:
    volumes:
      - ~/.config/rclone:/root/.config/rclone:ro
      - ~/.ssh:/root/.ssh:ro # Required for SFTP remotes using key_file
```

**Option 2: Embed the SSH key in rclone config**

Use `key_pem` instead of `key_file` to embed the private key directly in your rclone.conf:

```bash
# Convert your key to single-line format
awk '{printf "%s\\n", $0}' < ~/.ssh/id_rsa
```

Then update your rclone config:

```ini
[sftp-remote]
type = sftp
host = example.com
user = backup
key_pem = -----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5v...\n-----END OPENSSH PRIVATE KEY-----
```

**Option 3: Use ssh-agent**

Configure your rclone remote to use ssh-agent instead of a key file:

```ini
[sftp-remote]
type = sftp
host = example.com
user = backup
key_use_agent = true
```

Then mount the SSH agent socket and set the environment variable:

```yaml
services:
  zerobyte:
    environment:
      - SSH_AUTH_SOCK=/ssh-agent
    volumes:
      - ~/.config/rclone:/root/.config/rclone:ro
      - ${SSH_AUTH_SOCK}:/ssh-agent
```

---

### Rclone Volume Mount Issues

When using rclone as a **volume backend** (mounting cloud storage to back up from), additional requirements apply:

#### Prerequisites Check

If rclone volume mounting isn't working, verify these prerequisites on your system:

- **Linux host required:** Windows/macOS hosts cannot use rclone volumes. If you're on these platforms, you'll need to use a different volume backend.
- **`/dev/fuse` device:** Check if FUSE is available and properly passed to the container
- **`SYS_ADMIN` capability:** Required for mount operations inside containers
- **FUSE support on host:** Verify FUSE is installed and working on your Docker host

#### Common Mount Errors

**"mount helper error: fusermount3: failed to open /dev/fuse: Permission denied"**

Solutions in order of preference:

1. **Verify FUSE works on host first:**

   ```bash
   # On host
   rclone mount remote:path /tmp/test --daemon
   ls /tmp/test
   fusermount -u /tmp/test
   ```

2. **Ensure /dev/fuse is mounted in container:**

   ```yaml
   devices:
     - /dev/fuse:/dev/fuse
   ```

3. **Check user permissions inside container:**
   ```bash
   docker exec zerobyte ls -la /dev/fuse
   ```

**"mount helper error: fusermount3: mount failed: Operation not permitted"**

This indicates the container lacks `SYS_ADMIN` capability:

```yaml
cap_add:
  - SYS_ADMIN
```

---

### Still having issues?

If you've verified rclone works on the host and followed all troubleshooting steps above, gather this information for your issue report:

```bash
# Host verification
rclone version
rclone listremotes
rclone lsd remote: 2>&1

# Container verification
docker exec zerobyte ls -la /root/.config/rclone/
docker exec zerobyte env | grep RCLONE
docker logs zerobyte 2>&1 | tail -50

# Check container capabilities
docker inspect zerobyte --format='{{.HostConfig.CapAdd}}'
docker inspect zerobyte --format='{{.HostConfig.Devices}}'
```

Include the output (with sensitive data redacted) in your GitHub issue.
