# AGENTS.md

## Important instructions

- Never create migration files manually. Always use the provided command to generate migrations
- If you realize an automated migration is incorrect, make sure to remove all the associated entries from the `_journal.json` and the newly created files located in `app/drizzle/` before re-generating the migration

## Project Overview

Zerobyte is a backup automation tool built on top of Restic that provides a web interface for scheduling, managing, and monitoring encrypted backups. It supports multiple volume backends (NFS, SMB, WebDAV, SFTP, local directories) and repository backends (S3, Azure, GCS, local, and rclone-based storage).

## Technology Stack

- **Runtime**: Bun 1.3.1
- **Server**: Hono (web framework) with Bun runtime
- **Client**: React Router v7 (SSR) with React 19
- **Database**: SQLite with Drizzle ORM
- **Validation**: ArkType for runtime schema validation
- **Styling**: Tailwind CSS v4 + Radix UI components
- **Architecture**: Unified application structure (not a monorepo)
- **Code Quality**: Oxfmt for formatting, Oxlint for linting

## Repository Structure

This is a unified application with the following structure:

- `app/server` - Bun-based API server with Hono
- `app/client` - React Router SSR frontend components and modules
- `app/schemas` - Shared ArkType schemas for validation
- `app/drizzle` - Database migrations

### Type Checking

```bash
# Run type checking and generate React Router types
bun run tsc
```

### Testing

```bash
# Run all tests
bun run test

# Run a specific test file
bunx dotenv-cli -e .env.test -- bun test --preload ./app/test/setup.ts path/to/test.ts
```

### Building

```bash
# Build for production
bun run build
```

### Database Migrations

```bash
# Generate new migration from schema changes
bun gen:migrations

# Generate a custom empty migration
bunx drizzle-kit generate --custom --name=fix-timestamps-to-ms

```

### API Client Generation

```bash
# Generate TypeScript API client from OpenAPI spec
# Note: Server is always running don't need to start it separately
bun run gen:api-client
```

### Code Quality

```bash
# Format
bunx oxfmt format --write <path>

# Lint
bun run lint
```

## Architecture

### Server Architecture

The server follows a modular service-oriented architecture:

**Entry Point**: `app/server/index.ts`

- Initializes main API server on port 4096 (REST API + serves static frontend)

**Modules** (`app/server/modules/`):
Each module follows a controller � service � database pattern:

- `auth/` - User authentication and session management
- `volumes/` - Volume mounting/unmounting (NFS, SMB, WebDAV, SFTP, directories)
- `repositories/` - Restic repository management (S3, Azure, GCS, local, rclone)
- `backups/` - Backup schedule management and execution
- `notifications/` - Notification system with multiple providers (Discord, email, Gotify, Ntfy, Slack, Pushover)
- `driver/` - Docker volume plugin implementation
- `events/` - Server-Sent Events for real-time updates
- `system/` - System information and capabilities
- `lifecycle/` - Application startup/shutdown hooks

**Backends** (`app/server/modules/backends/`):
Each volume backend (NFS, SMB, WebDAV, SFTP, directory) implements mounting logic using system tools (mount.nfs, mount.cifs, davfs2, sshfs).

**Jobs** (`app/server/jobs/`):
Cron-based background jobs managed by the Scheduler:

- `backup-execution.ts` - Runs scheduled backups (every minute)
- `cleanup-dangling.ts` - Removes stale mounts (hourly)
- `healthchecks.ts` - Checks volume health (every 5 minutes)
- `repository-healthchecks.ts` - Validates repositories (every 10 minutes)
- `cleanup-sessions.ts` - Expires old sessions (daily)

**Core** (`app/server/core/`):

- `scheduler.ts` - Job scheduling system using node-cron
- `capabilities.ts` - Detects available system features
- `constants.ts` - Application-wide constants

**Utils** (`app/server/utils/`):

- `restic.ts` - Restic CLI wrapper with type-safe output parsing
- `spawn.ts` - Safe subprocess execution helpers
- `logger.ts` - Winston-based logging
- `crypto.ts` - Encryption utilities
- `errors.ts` - Error handling middleware

**Database** (`app/server/db/`):

- Uses Drizzle ORM with SQLite
- Schema in `schema.ts` defines: volumes, repositories, backup schedules, notifications, users, sessions
- Migrations: `app/drizzle/`

### Client Architecture

**Framework**: React Router v7 with SSR
**Entry Point**: `app/root.tsx`

The client uses:

- TanStack Query for server state management
- Auto-generated API client from OpenAPI spec (in `app/client/api-client/`)
- Radix UI primitives with custom Tailwind styling
- Server-Sent Events hook (`use-server-events.ts`) for real-time updates

Routes are organized in feature modules at `app/client/modules/*/routes/`.

### Shared Schemas

`app/schemas/` contains ArkType schemas used by both client and server:

- Volume configurations (NFS, SMB, WebDAV, SFTP, directory)
- Repository configurations (S3, Azure, GCS, local, rclone)
- Restic command output parsing types
- Backend status types

These schemas provide runtime validation and TypeScript types.

## Restic Integration

Zerobyte is a wrapper around Restic for backup operations. Key integration points:

**Repository Management**:

- Creates/initializes Restic repositories via `restic init`
- Supports multiple backends: local, S3, Azure Blob Storage, Google Cloud Storage, or any rclone-supported backend
- Stores single encryption password in `/var/lib/zerobyte/restic/password` (auto-generated on first run)

**Backup Operations**:

- Executes `restic backup` with user-defined schedules (cron expressions)
- Supports include/exclude patterns for selective backups
- Parses JSON output for progress tracking and statistics
- Implements retention policies via `restic forget --prune`

**Repository Utilities** (`utils/restic.ts`):

- `buildRepoUrl()` - Constructs repository URLs for different backends
- `buildEnv()` - Sets environment variables (credentials, cache dir)
- Type-safe parsing of Restic JSON output using ArkType schemas

**Rclone Integration** (`app/server/modules/repositories/`):

- Allows using any rclone backend as a Restic repository
- Dynamically generates rclone config and passes via environment variables
- Supports backends like Dropbox, Google Drive, OneDrive, Backblaze B2, etc.

## Environment & Configuration

**Runtime Environment Variables**:

- Database path: `./data/zerobyte.db` (configurable via `drizzle.config.ts`)
- Restic cache: `/var/lib/zerobyte/restic/cache`
- Restic password: `/var/lib/zerobyte/restic/password`
- Volume mounts: `/var/lib/zerobyte/mounts/<volume-name>`
- Local repositories: `/var/lib/zerobyte/repositories/<repo-name>`

**Capabilities Detection**:
On startup, the server detects available capabilities (see `core/capabilities.ts`):

- **rclone**: Requires `/root/.config/rclone` directory access
- System will gracefully degrade if capabilities are unavailable

## Common Workflows

### Adding a New Volume Backend

1. Create backend implementation in `app/server/modules/backends/<backend>/`
2. Implement `mount()` and `unmount()` methods
3. Add schema to `app/schemas/volumes.ts`
4. Update `volumeConfigSchema` discriminated union
5. Update backend factory in `app/server/modules/backends/backend.ts`

### Adding a New Repository Backend

1. Add backend type to `app/schemas/restic.ts`
2. Update `buildRepoUrl()` in `app/server/utils/restic.ts`
3. Update `buildEnv()` to handle credentials/configuration
4. Add DTO schemas in `app/server/modules/repositories/repositories.dto.ts`
5. Update repository service to handle new backend

### Adding a New Scheduled Job

1. Create job class in `app/server/jobs/<job-name>.ts` extending `Job`
2. Implement `run()` method
3. Register in `app/server/modules/lifecycle/startup.ts` with cron expression:
   ```typescript
   Scheduler.build(YourJob).schedule("* * * * *");
   ```

## Important Notes

- **TypeScript**: Uses `"type": "module"` - all imports must include extensions when targeting Node/Bun
- **Validation**: Prefer ArkType over Zod - it's used throughout the codebase
- **Visibility**: Prefer using the `cn` helper with `{ hidden: condition }` instead of conditional rendering with ternaries or `&&` for toggling element visibility in the DOM.
- **Database**: Timestamps are stored as Unix epoch integers, not ISO strings
- **Security**: Restic password file has 0600 permissions - never expose it
- **Mounting**: Requires privileged container or CAP_SYS_ADMIN for FUSE mounts
- **API Documentation**: OpenAPI spec auto-generated at `/api/v1/openapi.json`, docs at `/api/v1/docs`
