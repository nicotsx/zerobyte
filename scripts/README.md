# Scripts

Utility scripts for Zerobyte development and testing.

## Deploy a development agent

```bash
bun run dev:agent user@linux-server
```

Uses your normal SSH configuration and keys, detects the remote architecture, compiles the local source with Bun, uploads it, and runs the native installer. The agent is installed at `/usr/local/bin/zerobyte-agent` and runs in the background. Existing identity and shared folders are preserved; the service is restarted, so deploy between backup runs.

First-time setup prompts for the controller URL and connection code from the dashboard. The remote machine needs the usual agent prerequisites, including Restic and systemd. Sudo may prompt for your password. For a development HTTP controller, add `--allow-insecure`.

Use `--port 2222` for a custom SSH port. To avoid repeating the host, set `ZEROBYTE_DEV_AGENT_HOST` in your local environment or `.env.local`, then run just `bun run dev:agent`. This deploys unpublished local code; it does not push or publish a release.

## create-test-files.ts

Generates temporary test files with random content for testing Zerobyte backup functionality.

### Usage

```bash
bun scripts/create-test-files.ts [options]
```

### Options

| Option              | Description                           | Default          |
| ------------------- | ------------------------------------- | ---------------- |
| `-c, --count <num>` | Number of files to create             | 10               |
| `--min-size <size>` | Minimum file size                     | 1K               |
| `--max-size <size>` | Maximum file size                     | 1M               |
| `-o, --out <dir>`   | Output directory                      | ./tmp/test-files |
| `-n, --nested`      | Create files in nested subdirectories | false            |
| `-h, --help`        | Show help message                     | -                |

### Size Format

Sizes can be specified as: `<number>[K|M|G|T][B]`

- `100` = 100 bytes
- `10K` = 10 kilobytes
- `5M` = 5 megabytes
- `1G` = 1 gigabyte

### Examples

```bash
# Create 10 test files (default)
bun scripts/create-test-files.ts

# Create 50 files, 10K to 100K, with nested directories
bun scripts/create-test-files.ts -c 50 --min-size 10K --max-size 100K -n

# Create 5 files, 1MB to 10MB
bun scripts/create-test-files.ts -c 5 --min-size 1M --max-size 10M -o ./data/test-backup

# Create 100 small files in nested structure
bun scripts/create-test-files.ts -c 100 --min-size 100B --max-size 1K -n
```
