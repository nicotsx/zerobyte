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

```yaml
services:
  zerobyte:
    image: ghcr.io/nicotsx/zerobyte:v0.13
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
```

> [!WARNING]
> Do not try to point `/var/lib/zerobyte` on a network share. You will face permission issues and strong performance degradation.

Then, run the following command to start Zerobyte:

```bash
docker compose up -d
```

Once the container is running, you can access the web interface at `http://<your-server-ip>:4096`.

## Adding your first volume

Zerobyte supports multiple volume backends including NFS, SMB, WebDAV, and local directories. A volume represents the source data you want to back up and monitor.

To add your first volume, navigate to the "Volumes" section in the web interface and click on "Create volume". Fill in the required details such as volume name, type, and connection settings.

If you want to track a local directory on the same server where Zerobyte is running, you'll first need to mount that directory into the Zerobyte container. You can do this by adding a volume mapping in your `docker-compose.yml` file. For example, to mount `/path/to/your/directory` from the host to `/mydata` in the container, you would add the following line under the `volumes` section:

```diff
services:
  zerobyte:
    image: ghcr.io/nicotsx/zerobyte:v0.13
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
       image: ghcr.io/nicotsx/zerobyte:v0.13
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

## Propagating mounts to host

Zerobyte is capable of propagating mounted volumes from within the container to the host system. This is particularly useful when you want to access the mounted data directly from the host to use it with other applications or services.

In order to enable this feature, you need to change your bind mount `/var/lib/zerobyte` to use the `:rshared` flag. Here is an example of how to set this up in your `docker-compose.yml` file:

```diff
services:
  zerobyte:
    image: ghcr.io/nicotsx/zerobyte:v0.13
    container_name: zerobyte
    restart: unless-stopped
    ports:
      - "4096:4096"
    devices:
      - /dev/fuse:/dev/fuse
    environment:
      - TZ=Europe/Paris
    volumes:
      - /etc/localtime:/etc/localtime:ro
-     - /var/lib/zerobyte:/var/lib/zerobyte
+     - /var/lib/zerobyte:/var/lib/zerobyte:rshared
```

Restart the Zerobyte container to apply the changes:

```bash
docker compose down
docker compose up -d
```

## Docker plugin

Zerobyte can also be used as a Docker volume plugin, allowing you to mount your volumes directly into other Docker containers. This enables seamless integration with your containerized applications.

In order to enable this feature, you need to run Zerobyte with several items shared from the host. Here is an example of how to set this up in your `docker-compose.yml` file:

```diff
services:
  zerobyte:
    image: ghcr.io/nicotsx/zerobyte:v0.13
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
-     - /var/lib/zerobyte:/var/lib/zerobyte
+     - /var/lib/zerobyte:/var/lib/zerobyte:rshared
+     - /run/docker/plugins:/run/docker/plugins
+     - /var/run/docker.sock:/var/run/docker.sock
```

Restart the Zerobyte container to apply the changes:

```bash
docker compose down
docker compose up -d
```

Your Zerobyte volumes will now be available as Docker volumes that you can mount into other containers using the `--volume` flag:

```bash
docker run -v zb-abc12:/path/in/container nginx:latest
```

Or using Docker Compose:

```yaml
services:
  myservice:
    image: nginx:latest
    volumes:
      - zb-abc12:/path/in/container
volumes:
  zb-abc12:
    external: true
```

The volume name format is `zb-<short-id>` where `<short-id>` is the unique identifier shown on the volume's Docker tab in Zerobyte. This short ID remains stable even if you rename the volume. You can verify that the volume is available by running:

```bash
docker volume ls
```

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
