<div align="center">
  <h1>Zerobyte</h1>
  <h3>Powerful backup automation for your remote storage<br />Encrypt, compress, and protect your data with ease</h3>
  <a href="https://github.com/nicotsx/zerobyte/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/nicotsx/zerobyte" />
  </a>
  <br />
  <figure>
    <img src="https://github.com/nicotsx/zerobyte/blob/main/screenshots/backup-details.webp?raw=true" alt="Demo" />
    <figcaption>
      <p align="center">
        Backup management with scheduling and monitoring
      </p>
    </figcaption>
  </figure>
</div>

> [!WARNING]
> Zerobyte is still in version 0.x.x and is subject to major changes from version to version. I am developing the core features and collecting feedbacks. Expect bugs! Please open issues or feature requests

<p align="center">
<a href="https://www.buymeacoffee.com/nicotsx" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>
</p>

## Intro

Zerobyte is a backup automation tool that helps you save your data across multiple storage backends. Built on top of Restic, it provides an modern web interface to schedule, manage, and monitor encrypted backups of your remote storage.

### Features

- &nbsp; **Automated backups** with encryption, compression and retention policies powered by Restic
- &nbsp; **Flexible scheduling** For automated backup jobs with fine-grained retention policies
- &nbsp; **End-to-end encryption** ensuring your data is always protected
- &nbsp; **Multi-protocol support**: Backup from NFS, SMB, WebDAV, or local directories

## Installation

In order to run Zerobyte, you need to have Docker and Docker Compose installed on your server. Then, you can use the provided `docker-compose.yml` file to start the application.

### Configure Zerobyte via Config File


You can pre-configure backup sources (volumes), destinations (repositories), backup schedules, notification destinations and admin user using a config file (`zerobyte.config.json` by default (mounted in /app dir), or set `ZEROBYTE_CONFIG_PATH`).

Secrets/credentials in the config file can reference environment variables using `${VAR_NAME}` syntax for secure injection.

> **ℹ️ Config File Behavior**
>
> The config file is applied on startup using a **create-only** approach:
> - Resources defined in the config are only created if they don't already exist in the database
> - Existing resources with the same name are **not overwritten** - a warning is logged and the config entry is skipped
> - Changes made via the UI are preserved across container restarts
> - To update a resource from config, either modify it via the UI or delete it first
>
> This means the config file serves as "initial setup" rather than "desired state sync".

#### zerobyte.config.json Structure

```json
{
  "volumes": [
    // Array of volume objects. Each must have a unique "name" and a "config" matching one of the types below.
  ],
  "repositories": [
    // Array of repository objects. Each must have a unique "name" and a "config" matching one of the types below.
    // Optionally, "compressionMode" ("auto", "off", "max")
  ],
  "backupSchedules": [
    // Array of backup schedule objects as described below.
  ],
  "notificationDestinations": [
    // Array of notification destination objects as described below.
  ]
}
```

##### Volume Types

- **Local Directory**
  ```json
  {
    "name": "local-volume",
    "config": {
      "backend": "directory",
      "path": "/data",
      "readOnly": true
    }
  }
  ```

- **NFS**
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

- **SMB**
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

- **WebDAV**
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

##### Repository Types

- **Local Directory**
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
  > **Note for importing existing local repositories:** If you're migrating an existing repository (e.g., from a backup or another Zerobyte instance), include the `name` field in `config` with the original subfolder name, and set `isExistingRepository: true`. The actual restic repo is stored at `{path}/{name}`.
  >
  > **Example (migration):**
  > ```json
  > {
  >   "name": "my-local-repo",
  >   "config": {
  >     "backend": "local",
  >     "path": "/var/lib/zerobyte/repositories",
  >     "name": "abc123",
  >     "isExistingRepository": true
  >   }
  > }
  > ```
  > You can find the `config.name` value in an exported config under `repositories[].config.name`. This value must be unique across all repositories.

- **S3-Compatible**
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

- **Google Cloud Storage**
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

- **Azure Blob Storage**
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

- **WebDAV, rclone, SFTP, REST, etc.**
  (See documentation for required fields; all support env variable secrets.)

##### Backup Schedules

- **Example:**
  ```json
  {
    "volume": "local-volume",
    "repository": "local-repo",
    "cronExpression": "0 2 * * *",
    "retentionPolicy": { "keepLast": 7, "keepDaily": 7 },
    "includePatterns": ["important-folder"],
    "excludePatterns": ["*.tmp", "*.log"],
    "enabled": true,
    "notifications": ["slack-alerts", "email-admin"]
  }
  ```
- **Fields:**
  - `volume`: Name of the source volume
  - `repository`: Name of the destination repository
  - `cronExpression`: Cron string for schedule
  - `retentionPolicy`: Object with retention rules (e.g., keepLast, keepDaily)
  - `includePatterns`/`excludePatterns`: Arrays of patterns
  - `enabled`: Boolean
  - `notifications`: Array of notification destination names (strings) or detailed objects:
    - Simple: `["slack-alerts", "email-admin"]`
    - Detailed: `[{"name": "slack-alerts", "notifyOnStart": false, "notifyOnSuccess": true, "notifyOnFailure": true}]`

##### Notification Destinations

- **Examples:**
  - **Slack**
    ```json
    {
      "name": "slack-alerts",
      "config": {
        "type": "slack",
        "webhookUrl": "${SLACK_WEBHOOK_URL}",
        "channel": "#backups",
        "username": "zerobyte",
        "iconEmoji": ":floppy_disk:"
      }
    }
    ```
  - **Email**
    ```json
    {
      "name": "email-admin",
      "config": {
        "type": "email",
        "smtpHost": "smtp.example.com",
        "smtpPort": 587,
        "username": "admin@example.com",
        "password": "${EMAIL_PASSWORD}",
        "from": "zerobyte@example.com",
        "to": ["admin@example.com"],
        "useTLS": true
      }
    }
    ```
  - **Discord**
    ```json
    {
      "name": "discord-backups",
      "config": {
        "type": "discord",
        "webhookUrl": "${DISCORD_WEBHOOK_URL}",
        "username": "zerobyte",
        "avatarUrl": "https://example.com/avatar.png",
        "threadId": "1234567890"
      }
    }
    ```
  - **Gotify**
    ```json
    {
      "name": "gotify-notify",
      "config": {
        "type": "gotify",
        "serverUrl": "https://gotify.example.com",
        "token": "${GOTIFY_TOKEN}",
        "path": "/message",
        "priority": 5
      }
    }
    ```
  - **ntfy**
    ```json
    {
      "name": "ntfy-notify",
      "config": {
        "type": "ntfy",
        "serverUrl": "https://ntfy.example.com",
        "topic": "zerobyte-backups",
        "priority": "high",
        "username": "ntfyuser",
        "password": "${NTFY_PASSWORD}"
      }
    }
    ```
  - **Pushover**
    ```json
    {
      "name": "pushover-notify",
      "config": {
        "type": "pushover",
        "userKey": "${PUSHOVER_USER_KEY}",
        "apiToken": "${PUSHOVER_API_TOKEN}",
        "devices": "phone,tablet",
        "priority": 1
      }
    }
    ```
  - **Telegram**
    ```json
    {
      "name": "telegram-notify",
      "config": {
        "type": "telegram",
        "botToken": "${TELEGRAM_BOT_TOKEN}",
        "chatId": "123456789"
      }
    }
    ```
  - **Custom (shoutrrr)**
    ```json
    {
      "name": "custom-shoutrrr",
      "config": {
        "type": "custom",
        "shoutrrrUrl": "${SHOUTRRR_URL}"
      }
    }
    ```

- **Fields:**
  - `name`: Unique name for the notification config
  - `config.type`: Notification type (email, slack, discord, gotify, ntfy, pushover, telegram, custom)
  - `config`: Type-specific config with `type` field, secrets via `${ENV_VAR}`

##### Admin Setup (Automated)

- **Example (new instance):**
  ```json
  {
    "admin": {
      "username": "admin",
      "password": "${ADMIN_PASSWORD}",
      "recoveryKey": "${RECOVERY_KEY}"
    }
  }
  ```

- **Example (migration from another instance):**
  ```json
  {
    "admin": {
      "username": "admin",
      "passwordHash": "$argon2id$v=19$m=19456,t=2,p=1$...",
      "recoveryKey": "${RECOVERY_KEY}"
    }
  }
  ```

- **Fields:**
  - `username`: Admin username to create on first startup
  - `password`: Admin password for new instances (can use `${ENV_VAR}`)
  - `passwordHash`: Pre-hashed password for migration (exported from another instance)
  - `recoveryKey`: Optional recovery key (can use `${ENV_VAR}`) - if provided, the UI prompt to download recovery key will be skipped

> **Note:** Use either `password` OR `passwordHash`, not both. The `passwordHash` option is useful when migrating from another Zerobyte instance using an exported config with `includePasswordHash=true`.

**On first startup, Zerobyte will automatically create the admin user from the config file.**

> **⚠️ About the Recovery Key**
>
> The recovery key is a 64-character hex string that serves two critical purposes:
> 1. **Restic repository password** - Used to encrypt all your backup data
> 2. **Database encryption key** - Used to encrypt credentials stored in Zerobyte's database
>
> **If you lose this key, you will lose access to all your backups and stored credentials.**
>
> **Generating a recovery key ahead of time:**
> ```bash
> # Using OpenSSL (Linux/macOS)
> openssl rand -hex 32
>
> # Using Python
> python3 -c "import secrets; print(secrets.token_hex(32))"
> ```
>
> **Retrieving from an existing instance:**
> - Download via UI: Settings → Download Recovery Key
> - Or read directly from the container: `docker exec zerobyte cat /var/lib/zerobyte/data/restic.pass`

---

**Notes:**
- All secrets (passwords, keys) can use `${ENV_VAR}` syntax to inject from environment variables.
- All paths must be accessible inside the container (mount host paths as needed).
- `readOnly` is supported for all volume types that allow it, including local directories.

```yaml
services:
  zerobyte:
    image: ghcr.io/nicotsx/zerobyte:v0.19
    container_name: zerobyte
    restart: unless-stopped
    cap_add:
      - SYS_ADMIN
    ports:
      - "4096:4096"
    devices:
      - /dev/fuse:/dev/fuse
    environment:
      - TZ=Europe/Paris  # Set your timezone here
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - /var/lib/zerobyte:/var/lib/zerobyte
      - ./zerobyte.config.json:/app/zerobyte.config.json:ro # Mount your config file
```

> [!WARNING]
> Do not try to point `/var/lib/zerobyte` on a network share. You will face permission issues and strong performance degradation.

Then, run the following command to start Zerobyte:

```bash
docker compose up -d
```

Once the container is running, you can access the web interface at `http://<your-server-ip>:4096`.

### Simplified setup (No remote mounts)

If you only need to back up locally mounted folders and don't require remote share mounting capabilities, you can remove the `SYS_ADMIN` capability and FUSE device from your `docker-compose.yml`:

```yaml
services:
  zerobyte:
    image: ghcr.io/nicotsx/zerobyte:v0.19
    container_name: zerobyte
    restart: unless-stopped
    ports:
      - "4096:4096"
    environment:
      - TZ=Europe/Paris  # Set your timezone here
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - /var/lib/zerobyte:/var/lib/zerobyte
      - /path/to/your/directory:/mydata
```

**Trade-offs:**
- ✅ Improved security by reducing container capabilities
- ✅ Support for local directories
- ✅ Keep support all repository types (local, S3, GCS, Azure, rclone)
- ❌ Cannot mount NFS, SMB, or WebDAV shares directly from Zerobyte

If you need remote mount capabilities, keep the original configuration with `cap_add: SYS_ADMIN` and `devices: /dev/fuse:/dev/fuse`.

## Adding your first volume

Zerobyte supports multiple volume backends including NFS, SMB, WebDAV, and local directories. A volume represents the source data you want to back up and monitor.

To add your first volume, navigate to the "Volumes" section in the web interface and click on "Create volume". Fill in the required details such as volume name, type, and connection settings.

If you want to track a local directory on the same server where Zerobyte is running, you'll first need to mount that directory into the Zerobyte container. You can do this by adding a volume mapping in your `docker-compose.yml` file. For example, to mount `/path/to/your/directory` from the host to `/mydata` in the container, you would add the following line under the `volumes` section:

```diff
services:
  zerobyte:
    image: ghcr.io/nicotsx/zerobyte:v0.19
    container_name: zerobyte
    restart: unless-stopped
    cap_add:
      - SYS_ADMIN
    ports:
      - "4096:4096"
    devices:
      - /dev/fuse:/dev/fuse
    environment:
      - TZ=Europe/Paris
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - /var/lib/zerobyte:/var/lib/zerobyte
+     - /path/to/your/directory:/mydata
```

After updating the `docker-compose.yml` file, restart the Zerobyte container to apply the changes:

```bash
docker compose down
docker compose up -d
```

Now, when adding a new volume in the Zerobyte web interface, you can select "Directory" as the volume type and search for your mounted path (e.g., `/mydata`) as the source path.

![Preview](https://github.com/nicotsx/zerobyte/blob/main/screenshots/add-volume.png?raw=true)

## Creating a repository

A repository is where your backups will be securely stored encrypted. Zerobyte supports multiple storage backends for your backup repositories:

- **Local directories** - Store backups on local disk at `/var/lib/zerobyte/repositories/<repository-name>`
- **S3-compatible storage** - Amazon S3, MinIO, Wasabi, DigitalOcean Spaces, etc.
- **Google Cloud Storage** - Google's cloud storage service
- **Azure Blob Storage** - Microsoft Azure storage
- **rclone remotes** - 40+ cloud storage providers via rclone (see below)

Repositories are optimized for storage efficiency and data integrity, leveraging Restic's deduplication and encryption features.

To create a repository, navigate to the "Repositories" section in the web interface and click on "Create repository". Fill in the required details such as repository name, type, and connection settings.

### Using rclone for cloud storage

Zerobyte can use [rclone](https://rclone.org/) to support 40+ cloud storage providers including Google Drive, Dropbox, OneDrive, Box, pCloud, Mega, and many more. This gives you the flexibility to store your backups on virtually any cloud storage service.

**Setup instructions:**

1. **Install rclone on your host system** (if not already installed):
   ```bash
   curl https://rclone.org/install.sh | sudo bash
   ```

2. **Configure your cloud storage remote** using rclone's interactive config:
   ```bash
   rclone config
   ```
   Follow the prompts to set up your cloud storage provider. For OAuth providers (Google Drive, Dropbox, etc.), rclone will guide you through the authentication flow.

3. **Verify your remote is configured**:
   ```bash
   rclone listremotes
   ```

4. **Mount the rclone config into the Zerobyte container** by updating your `docker-compose.yml`:
   ```diff
   services:
     zerobyte:
       image: ghcr.io/nicotsx/zerobyte:v0.19
       container_name: zerobyte
       restart: unless-stopped
       cap_add:
         - SYS_ADMIN
       ports:
         - "4096:4096"
       devices:
         - /dev/fuse:/dev/fuse
       environment:
         - TZ=Europe/Paris
       volumes:
         - /etc/localtime:/etc/localtime:ro
         - /var/lib/zerobyte:/var/lib/zerobyte
   +     - ~/.config/rclone:/root/.config/rclone
   ```

5. **Restart the Zerobyte container**:
   ```bash
   docker compose down
   docker compose up -d
   ```

6. **Create a repository** in Zerobyte:
   - Select "rclone" as the repository type
   - Choose your configured remote from the dropdown
   - Specify the path within your remote (e.g., `backups/zerobyte`)

For a complete list of supported providers, see the [rclone documentation](https://rclone.org/).

## Your first backup job

Once you have added a volume and created a repository, you can create your first backup job. A backup job defines the schedule and parameters for backing up a specific volume to a designated repository.

When creating a backup job, you can specify the following settings:
- **Schedule**: Define how often the backup should run (e.g., daily, weekly)
- **Retention Policy**: Set rules for how long backups should be retained (e.g., keep daily backups for 7 days, weekly backups for 4 weeks)
- **Paths**: Specify which files or directories to include in the backup

After configuring the backup job, save it and Zerobyte will automatically execute the backup according to the defined schedule.
You can monitor the progress and status of your backup jobs in the "Backups" section of the web interface.

![Preview](https://github.com/nicotsx/zerobyte/blob/main/screenshots/backups-list.png?raw=true)

## Restoring data

Zerobyte allows you to easily restore your data from backups. To restore data, navigate to the "Backups" section and select the backup job from which you want to restore data. You can then choose a specific backup snapshot and select the files or directories you wish to restore. The data you select will be restored to their original location.

![Preview](https://github.com/nicotsx/zerobyte/blob/main/screenshots/restoring.png?raw=true)

## Third-Party Software

This project includes the following third-party software components:

### Restic

Zerobyte includes [Restic](https://github.com/restic/restic) for backup functionality.

- **License**: BSD 2-Clause License
- **Copyright**: Copyright (c) 2014, Alexander Neumann <alexander@bumpern.de>
- **Status**: Included unchanged
- **License Text**: See [LICENSES/BSD-2-Clause-Restic.txt](LICENSES/BSD-2-Clause-Restic.txt)

For a complete list of third-party software licenses and attributions, please refer to the [NOTICES.md](NOTICES.md) file.

## Contributing

Contributions by anyone are welcome! If you find a bug or have a feature request, please open an issue on GitHub. If you want to contribute code, feel free to fork the repository and submit a pull request. We require that all contributors sign a Contributor License Agreement (CLA) before we can accept your contributions. This is to protect both you and the project. Please see the [CONTRIBUTING.md](CONTRIBUTING.md) file for more details.
