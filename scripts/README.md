# Scripts

Utility scripts for Zerobyte development and testing.

## create-test-files.ts

Generates temporary test files with random content for testing Zerobyte backup functionality.

### Usage

```bash
bun scripts/create-test-files.ts [options]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-c, --count <num>` | Number of files to create | 10 |
| `--min-size <size>` | Minimum file size | 1K |
| `--max-size <size>` | Maximum file size | 1M |
| `-o, --out <dir>` | Output directory | ./tmp/test-files |
| `-n, --nested` | Create files in nested subdirectories | false |
| `-h, --help` | Show help message | - |

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
