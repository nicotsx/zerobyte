## Important instructions

- Never create migration files manually. Always use the provided command to generate migrations
- If you realize an automated migration is incorrect, make sure to remove all the associated entries from the `_journal.json` and the newly created files located in `app/drizzle/` before re-generating the migration
- The dev server runs through Portless. Start it with `bun run dev`, then use `portless get zerobyte` to get the current worktree-specific URL. Do not assume a fixed port like `3000` or `4096`. Username is `admin` and password is `password`
- The repo is https://github.com/nicotsx/zerobyte
- If you need to run a specific restic command on a repository, you can open and use the dev panel with `Meta+Shift+D`

## Project Overview

Zerobyte is a backup automation tool built on top of Restic that provides a web interface for scheduling, managing, and monitoring encrypted backups. It supports multiple volume backends (NFS, SMB, WebDAV, SFTP, local directories) and repository backends (S3, Azure, GCS, local, and rclone-based storage).

### Development Server

```bash
# Start the dev server through Portless
bun run dev

# Get the current app URL for this worktree
portless get zerobyte

# Inspect active Portless routes if needed
portless list
```

Portless applies git worktree prefixes automatically, so linked worktrees may return URLs like `https://branch-name.zerobyte.localhost`. Use the Portless URL for browser testing and manual verification.

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
bunx dotenv run -f .env.test -- bunx --bun vitest run --project server path/to/test.ts
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

### Configuration Export Schema Changes

Configuration exports are permanent recovery artifacts. When a durable transferable field, backend, relationship, or serialized meaning changes, add a new config-transfer wire version. Do not modify a released version's schema, model, codec, fixture, or migration.

For a new version:

- Add a self-contained versioned payload schema, model, and codec under `app/server/modules/system/config-transfer/vN/`. Historical schemas may reuse only immutable wire fragments, never live application schemas.
- Add exactly one adjacent `vN-1` to `vN` model migration with concrete input and output types. Compose these functions explicitly in the version branches in `payload.ts` so every historical version reaches the current model. Keep every historical decoder and migration so old exports remain importable.
- Make the new version current in `payload.ts`; export only the current version while retaining every import branch.
- Add a permanent fixture and tests for wire round-tripping, migration defaults/semantic conversions, current-model import, and the clear update-required error for newer unsupported exports.
- Keep the exact type-equality check between the current transfer model and the current encoded model so new transferable fields cannot be silently omitted.

Changes that do not affect transferable meaning, such as database indexes, internal IDs, caches, UI state, and refactors that preserve the wire representation, do not require a new version.

### API Client Generation

```bash
bun run gen:api-client
```

### Code Quality

```bash
# Format
bun run fmt -- <path>

# Lint
bun run lint
```

### Invalidation

The frontend has an automatic invalidation setup which runs after every mutation.
Do not implement any invalidation logic in the frontend.
