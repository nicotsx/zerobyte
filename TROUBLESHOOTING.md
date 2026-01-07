# Troubleshooting

If you encounter any issues while using Zerobyte, you can check the application logs for more information.
These logs can help you identify and resolve common problems; you should also check existing and closed issues on GitHub.
In case you need further assistance, feel free to open a new issue with detailed information about the problem you are facing and any relevant log entries.

> [!WARNING]
> Make sure to never share sensitive information such as passwords, access keys, or personal data in public issues so remove them from logs before posting.

To view the logs, run the command below:

```bash
# replace 'zerobyte' with your container name if different
docker logs -f zerobyte
```

---

## Common issues

### Permission denied errors when mounting remote shares

Mounting remote filesystems (such as SMB/CIFS) requires kernel-level privileges. When Zerobyte attempts to perform mounts from inside a container, additional permissions may be required.

Ensure that:

* Remote share credentials are correct
* The host kernel supports the target filesystem (e.g. CIFS module is available)
* Docker is running in **rootful mode** (rootless Docker cannot perform kernel mounts)

In some environments, Linux security mechanisms such as AppArmor or seccomp may block mount-related operations even when the required capabilities are present.

---

### Security levels for mounting remote shares

Zerobyte supports multiple deployment models depending on your security requirements and environment.

---

#### **Secure** (recommended)

Mount remote shares **outside of Zerobyte** (on the host) and point Zerobyte to an already mounted local path.

This approach avoids granting additional privileges to the container and is the most portable and secure option.

```yaml
services:
  zerobyte:
    volumes:
      - /mnt/your-remote-share:/data
```

Remote mounts can be managed via `systemd`, `autofs`, or manual host mounts.

---

#### **Advanced** (Zerobyte performs mounts)

If Zerobyte must perform filesystem mounts itself, the container requires the `SYS_ADMIN` capability.

```yaml
services:
  zerobyte:
    cap_add:
      - SYS_ADMIN
```

> ⚠️ Granting `SYS_ADMIN` allows the container to perform mount operations and should be used only when strictly necessary.

---

#### AppArmor-enabled systems (Ubuntu/Debian)

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

#### Seccomp-restricted environments

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

#### SELinux-enabled systems (CentOS/Fedora)

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

#### **Not recommended** (When all else fails)

Running the container in privileged mode disables most container isolation mechanisms and significantly increases the attack surface.

This option should be used only as a last resort for troubleshooting.

```yaml
services:
  zerobyte:
    privileged: true
```

---

### Notes on FUSE-based backends

Access to `/dev/fuse` is required **only for FUSE-based filesystems** (such as `sshfs` or `rclone mount`).

It is **not required** for SMB/CIFS mounts.

### Rclone mount issues

When using `rclone` you are getting errors like:

```bash
bun: Failed to spawn process: EACCES
error > Failed to list rclone remotes: bun: Failed to spawn process: EACCES
```

Try to disable the AppArmor confinement for the container as described in the [AppArmor-enabled systems](#apparmor-enabled-systems-ubuntudebian) section above or [Seccomp-restricted environments](#seccomp-restricted-environments) section.
