# Implementation plan — Snapshot disk usage explorer (`du`/`ncdu` for snapshots)

Ref: [nicotsx/zerobyte#994](https://github.com/nicotsx/zerobyte/issues/994)

## Status

Phase 1 is largely implemented. The rest of this document is the original plan,
kept as the design rationale, with the two places the implementation
deliberately diverged marked **[changed during implementation]**.

**Landed**

- `@zerobyte/core/usage`: the streaming fold and the local source walker
- `snapshot_usage_scans` table, gzipped trees, per-schedule retention
- Backup-time capture for locally mounted volumes
- `GET …/usage` (drill-down) and `GET …/usage/largest-files`
- `POST /backups/:shortId/exclusions`
- "Storage usage" tab: sorted rows, proportional bars, breadcrumb drill-down,
  exclude dialog

**Outstanding in phase 1**

- Capture for backups executed on a remote agent. Needs a `backup.usage`
  protocol message and an agent-side walk; the controller cannot reach the
  source. This is the largest gap.
- `forget` does not delete usage trees for the snapshots it removes, so
  retention-forgotten snapshots leave orphan rows. `delete-snapshots-command.ts`
  does clean up; the forget path needs the same call.
- `backup_schedules_table.collect_storage_usage` exists and the capture honours
  it, but it is in no DTO and no form, so it cannot actually be turned off.
  Either wire it into the schedule form or drop the column.
- No documentation in `apps/docs`.
- No test coverage for the explorer component: the render test hung the client
  runner and was removed rather than diagnosed.

**Not started:** phases 2, 3 and 4 below. Note that phase 3's endpoint already
exists and returns both the largest files and the extension rollup — that work
is now UI-only.

## Goal

Three jobs, in order, all reachable without leaving the UI:

1. **Find** — "which paths in this snapshot are eating the space?" Sorted-by-size drill-down, `ncdu` style.
2. **Judge** — "should this be backed up?" Enough context per row (size, % of snapshot, file count, newest mtime, extension mix) to decide.
3. **Exclude** — "no, drop it." One click from the row to an exclude pattern appended to the owning backup schedule.

The issue comment asks for exactly this: _"mount the restic locally and use ncdu to browse the files and paths by size… Show size of child folders similar to (nc)du"_.

## What already exists

| Piece                          | Location                                                                                                                                                                                | Notes                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `restic ls` wrapper            | `packages/core/src/restic/commands/ls.ts`                                                                                                                                               | Streams NDJSON via `safeSpawn` (readline, no buffering). Non-recursive: passes a `path` arg so restic lists one level. Zod-validates every node. |
| Snapshot files API             | `app/server/modules/repositories/repositories.controller.ts:170` → `repositories.service.ts:297`                                                                                        | `GET /:shortId/snapshots/:snapshotId/files`, per-level, semaphore(2) + shared repo mutex, cached in `cache.db`.                                  |
| File browser UI                | `app/client/components/file-browsers/snapshot-tree-browser.tsx` → `file-browser.tsx` → `file-tree.tsx`                                                                                  | Lazy per-level expansion. `FileEntry` already carries `size`, and `ByteSize` already renders it — but only _file_ sizes; folders show nothing.   |
| Exclude config                 | `backup_schedules_table.exclude_patterns` (`app/server/db/schema.ts:443`), edited as free text in `create-schedule-form/exclude-section.tsx`, written via `PATCH /api/backups/:shortId` | Passed to restic through `--exclude-file` (`packages/core/src/restic/commands/backup.ts:100`), so absolute anchored patterns work verbatim.      |
| Long-running job plumbing      | `app/schemas/tasks.ts`, `tasks.store.ts`, `tasks.lifecycle.ts`, `repositories/commands/doctor-command.ts`                                                                               | Task kinds, progress, cancellation, SSE. `doctor-command.ts` is the template to copy.                                                            |
| Persisted computed restic data | `repositories_table.stats` + `helpers/repository-stats.ts`                                                                                                                              | House precedent for caching expensive restic output in the main DB.                                                                              |

So the browser and the exclude field both exist. What's missing is **subtree sizes**, and a path from "this folder is 400 GB" to "excluded".

## Core design decision

Folder sizes cannot be computed lazily. To size the children of a directory you must walk each child's whole subtree — at the snapshot root that _is_ the whole tree, and drilling down re-walks the same blobs. So lazy costs the same as eager and then repeats itself.

**Do one full recursive walk, fold it into a size tree, persist it.** The only question is _where the walk reads from_ — and on metered backends (per-request or per-GB egress) the answer must not be "the remote repository".

### Primary path: capture the tree at backup time, from the local source

At backup time the volume is mounted locally (`volumePath` in `backup.helpers.ts:30`), and restic is already walking and statting every file in it. **Nothing needs to be read from the repository to know how big the source directories are.** So the default way a snapshot gets its size tree is: the backup produces it, for free, and we store it keyed by the snapshot id that backup created.

Two ways to get the data at backup time:

**(A) Piggyback on `restic backup --verbose=2 --json`.** With `-vv`, restic emits a `verbose_status` line per item — `{"message_type":"verbose_status","action":"unchanged","item":"/path","data_size":N,"data_size_in_repo":M,...}`. Costs nothing extra: restic is walking anyway. `data_size_in_repo` would additionally give _post-dedup, post-compression_ bytes, which is strictly better data than `restic ls` can produce.

⚠️ **This needs an empirical check before committing to it.** My reading of restic's archiver is that the unchanged-file path reports a zero-valued `ItemStats`, which would mean `data_size: 0` for every unmodified file and make the output useless for a whole-tree picture — but I could not verify that in this environment (restic isn't installed here). The check is ~10 minutes: back up a directory twice against a local test repo with `--verbose=2 --json` and look at whether the second run's `unchanged` lines carry a nonzero `data_size`. There's a secondary concern either way: `-vv` is one JSON line per file, so at millions of files it adds real parsing load to the backup hot path. If we adopt it, parse those lines with a cheap prefix check, never Zod.

**(B) Walk the mounted source ourselves as a step of the backup task.** Guaranteed correct, zero remote reads, no coupling to restic's output quirks. It's a second `readdir`+`lstat` pass over the source, but it runs immediately after restic's own walk with the dentry/inode cache hot, and it is all local I/O.

**Recommendation: build (B), and switch to (A) only if the verification says the sizes are really there.** (B) is the low-risk version of the same idea and it is the thing that actually removes the remote reads.

Because this is source-side, it also answers a question the snapshot-side view can't: it sees paths that were _excluded_, so the UI can show "on disk 4.2 TB / in this snapshot 3.1 TB" — and that gap is exactly what your current excludes are saving you. For jobs #2 and #3 (_"should this be backed up?"_, _"exclude it"_) this is the better primitive, not a compromise.

**Where it runs:** wherever the backup runs. Local backups → in the server process. Agent-run backups (`apps/agent/src/commands/backup-run.ts`) → on the agent, which means a new agent-protocol message. Send it as its own `backup.usage` message rather than inflating `backup.completed` (`packages/contracts/src/agent-protocol.ts:232`), since the payload is hundreds of KB.

### Secondary path: on-demand snapshot scan, for snapshots that predate the feature

Backup-time capture only covers snapshots taken after this ships. Historical snapshots still need a read of the repository:

```
restic --repo <url> --json ls --long --no-lock <snapshotId>
```

With **no path argument** restic lists the entire snapshot recursively — no `--recursive` flag needed, so no restic-version coupling (pinned at 0.19.1 in `Dockerfile:4`). `--no-lock` is safe here (`ls` is read-only) and avoids a lock-file PUT + DELETE per scan; it's already in the allowlist at `validate-custom-params.ts:44`.

**Correcting what I said last time:** I claimed this "re-reads every tree blob against remote storage on every run." That's wrong in the common case, and the reason matters:

- restic caches **index files and tree blobs** locally by default. Data blobs are not cached — but `restic ls` only ever reads tree blobs.
- restic writes the tree blobs it uploads into that local cache during `backup`.
- `RESTIC_CACHE_DIR` here is `/var/lib/zerobyte/restic/cache` (`app/server/core/constants.ts:8`) — inside the `/var/lib/zerobyte` bind mount (`compose.yaml:21,51`), so it is **already persistent** across restarts, and nothing in the codebase ever clears it.

So for a snapshot this instance created, with the cache intact, `restic ls` is nearly all local reads; remote traffic is the snapshot file plus index metadata — a handful of requests, not one per file. The genuinely cold cases are: cache lost or never populated, a repository created on another machine, or a mirror destination populated by `restic copy`.

### Guards, so a scan can never surprise you with a bill

1. **Never automatic.** Scans are always explicitly requested. (This also settles open question #1 from the previous draft: no auto-scan after backup — backup-time capture makes it unnecessary anyway.)
2. **Warm/cold disclosure in the confirm dialog.** Before scanning, check whether this repository has a populated cache directory and say so plainly: _"restic's local metadata cache for this repository is warm (1.4 GB) — this scan should read little or nothing from the remote"_ vs _"cache is empty — this scan will download this snapshot's directory metadata from the remote."_
3. **Per-repository opt-out: "Never read this repository for usage scans."** A boolean on `repositories_table`. When set, the usage view offers only backup-time-captured trees and the scan button is disabled with the reason shown. Belt and braces for cold-storage and per-request-billed backends.
4. **Report what it cost.** Measure the repository's cache-directory growth across the scan and show it: _"read ~180 MB of metadata."_ A proxy rather than a true byte count, but honest and actionable.

### Streaming fold, O(1) memory per node — shared by both paths

Both a `restic ls` stream and a local filesystem walk produce the same thing: nodes in DFS order, parent before children. So **one fold implementation serves both**, and the two producers are just different iterators feeding it. Keep a stack of open directories:

- pop stack entries that are no longer a prefix of the incoming path — on pop, the directory's subtree total is final; fold it into its parent and decide whether to keep it
- `type === "dir"` → push a frame
- `type === "file"` → add `size` to the top frame, offer to the top-N heap, bump the extension tally

Bounded state: stack ≈ tree depth, top-files heap fixed at N, extension map capped, directory map capped (below). Nothing scales with file count.

**Skip Zod per node.** `ls.ts` runs `lsNodeSchema.safeParse` on every line; at 5M files that dominates the runtime. The scanner does `JSON.parse` plus a hand-rolled primitive check on `type`/`path`/`size`. Deliberate, and worth a comment in the code.

### Pruning the persisted tree

Keep every entry whose subtree total ≥ `threshold`. If the map exceeds 2× a hard cap, raise the threshold and sweep. No depth cap — a deep-but-huge path must not disappear. Each kept directory records `truncatedChildren: { count, size }` so a drill-down can honestly show _"312 smaller items (44 MB) not shown"_ and the numbers still add up.

**[changed during implementation]** Two corrections to the above:

- The threshold **starts at zero**, not at `max(1 MiB, total × 0.0001)`, and rises only under pressure. A fixed floor made small backups nearly empty — a 10 MB source would have had almost every file pruned. Starting at zero means a small tree keeps everything and only a large one degrades.
- **Files are kept as entries too**, not just directories, and the cap (`maxEntries`) covers both. The plan persisted only directories, which meant a folder holding one enormous file drilled down into an empty list. `largestFiles` is then a view over the kept files rather than a separate heap.

Escalation fires at twice the cap to stay amortised, and `finish()` trims once more so the cap the caller asked for is real.

### Persistence

New table (generate with `bun gen:migrations` — never hand-write the migration, per `AGENTS.md`):

```ts
export const snapshotUsageScansTable = sqliteTable(
	"snapshot_usage_scans",
	{
		id: int().primaryKey({ autoIncrement: true }),
		repositoryId: text("repository_id")
			.notNull()
			.references(() => repositoriesTable.id, { onDelete: "cascade" }),
		snapshotId: text("snapshot_id").notNull(), // short_id
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		formatVersion: int("format_version").notNull(),
		source: text("source").$type<"backup" | "scan">().notNull(), // captured at backup time, or scanned from the repo
		totalSize: int("total_size").notNull(),
		fileCount: int("file_count").notNull(),
		dirCount: int("dir_count").notNull(),
		scannedAt: int("scanned_at", { mode: "number" }).notNull(),
		durationMs: int("duration_ms").notNull(),
		tree: blob("tree").notNull(), // gzipped JSON, see below
	},
	(t) => [uniqueIndex("snapshot_usage_scans_repo_snapshot_uidx").on(t.repositoryId, t.snapshotId)],
);
```

The shipped table also carries `scheduleShortId`, which retention groups by. See `app/server/db/schema.ts` for the authoritative definition.

`source` matters to the UI: a `"backup"` row is source-side (sees excluded paths, sizes are what was on disk), a `"scan"` row is snapshot-side (only what was actually stored). Label the view accordingly rather than pretending they're the same number.

**Store the tree gzipped.** Once every backup writes a row, this table grows with snapshot count, and an uncompressed 50k-directory tree is several MB. Directory-path JSON compresses ~10:1 — `Bun.gzipSync` on write, `Bun.gunzipSync` on read, a few hundred KB per row. Pair that with retention: keep trees for the N most recent snapshots per schedule (default 10, configurable) plus any the user pins, and drop the rest. Without this, a nightly schedule quietly adds ~1 GB/year to the SQLite file.

Not `cache.db`: every backup run calls `cache.delByPrefix(cacheKeys.repository.all(id))` (`backup-lifecycle.ts:182`, `backup-maintenance.ts:26`, …), which would throw away a hard-won tree on every backup — and for scan-sourced rows on a metered backend, that's throwing away money. A real table also gets cascade-delete for free and lets the UI answer "which snapshots have data?".

Invalidation: delete rows for snapshots removed by `delete-snapshots-command.ts` and by `forget`. Bump `formatVersion` to invalidate en masse when the shape changes.

## Data model

```ts
// packages/core/src/restic/snapshot-usage.ts  (shared client/server)
export type SnapshotUsageDir = {
	path: string; // absolute, as it appears in the snapshot
	name: string;
	size: number; // subtree total, apparent/original bytes
	ownSize: number; // bytes in files directly inside this dir
	fileCount: number; // subtree
	dirCount: number; // subtree
	maxMtime: number; // newest mtime anywhere in the subtree (epoch ms)
	truncatedChildren?: { count: number; size: number };
};

export type SnapshotUsageFile = { path: string; size: number; mtime: number };

export type SnapshotUsageTree = {
	formatVersion: 1;
	roots: string[]; // snapshot.paths
	totals: { size: number; fileCount: number; dirCount: number };
	dirs: SnapshotUsageDir[]; // sorted by path
	largestFiles: SnapshotUsageFile[]; // top 1000, size desc
	byExtension: { ext: string; size: number; count: number }[]; // top 100
	limits: { minSize: number; maxDirs: number; topFiles: number; topExtensions: number };
};
```

## Backend work

**1. The fold** — `packages/core/src/usage/fold.ts`

`createUsageFold({ limits })` → `{ push(node), finish(): SnapshotUsageTree }`. Pure, producer-agnostic, no restic and no `fs` import. This is the piece that gets the heavy unit tests.

**2a. Producer — local source walk** — `packages/core/src/usage/walk-source.ts`

DFS `readdir(withFileTypes)` + `lstat`, emitting into the fold. Honours `oneFileSystem` (compare `st_dev`) and skips symlinks without following them. Takes `signal`. This is what runs at backup time and it never touches the repository.

**2b. Producer — snapshot scan** — `packages/core/src/restic/commands/scan-usage.ts`

`scanUsage(config, snapshotId, options, deps)` returning an Effect, same shape as the other commands; wires into `createRestic` in `server.ts`. Streams `restic ls --long --no-lock` into the same fold. Takes `signal` and `onProgress({ nodesScanned, bytesScanned, currentPath })`, throttled to ~1 Hz.

**3. Backup-time capture** — `app/server/modules/backups/backup-executor.ts` / `apps/agent/src/commands/backup-run.ts`

After restic reports the summary and we know the new snapshot id, run `walkSource` over `volumePath` and persist the row with `source: "backup"`. Rules:

- **Never fail the backup because of it.** Wrap in a catch that logs and moves on; a usage tree is a nice-to-have, a backup is not.
- **Never extend the backup's critical section.** Run it after the repository lock is released.
- Make it skippable — a per-schedule "collect storage usage" toggle, default on, so anyone with a pathological source tree can turn it off.
- Agent-run backups emit a new `backup.usage` message (`packages/contracts/src/agent-protocol.ts`) carrying the gzipped tree; the controller persists it. Keep it off `backup.completed`, whose payload should stay small.

**4. Task kind** — `app/schemas/tasks.ts`

Add `"snapshotUsage"` to `taskKinds`, plus input (`{ kind, repositoryId, snapshotId }`), progress (`{ kind, nodesScanned, bytesScanned, currentPath }`) and result (`{ kind, totalSize, fileCount, dirCount, durationMs }`) variants of the discriminated unions.

**5. Task command** — `app/server/modules/repositories/commands/scan-usage-command.ts`

For the on-demand path only. Modelled on `doctor-command.ts`: `runTaskLifecycle`, `repoMutex.acquireShared(repository.id, \`usage:${snapshotId}\`)`, reuse the `getLsLimiter`semaphore so a scan can't starve the interactive file browser. Refuses to start when the repository has the "never read for usage scans" flag set. Writes the row with`source: "scan"`. Register in `commands/index.ts`.

**6. Service + endpoints** — `repositories.service.ts` / `repositories.controller.ts`

| Method | Route                                                 | Behaviour                                                                                                                                                                                                                      |
| ------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/:shortId/snapshots/:snapshotId/usage`               | `?path=&limit=500&sort=size`. Returns the requested dir plus its children, sorted desc, and the row's `source`. `404` with a distinguishable code when there's no data; payload naming the in-flight task when one is running. |
| `POST` | `/:shortId/snapshots/:snapshotId/usage/scan`          | Starts (or returns the existing) scan task. Idempotent per `(repo, snapshot)` via `taskStore.findActiveByResource`. `409` when the repository is opted out.                                                                    |
| `GET`  | `/:shortId/snapshots/:snapshotId/usage/scan-estimate` | Cache warmth for this repository — cache-dir size, whether it's populated — so the confirm dialog can tell the truth about what a scan will cost.                                                                              |
| `GET`  | `/:shortId/snapshots/:snapshotId/usage/largest-files` | Top-N flat list, paginated.                                                                                                                                                                                                    |

Gunzip + parse the tree into a `Map<path, dir>` + child index behind a tiny LRU (2 entries) so drill-down doesn't re-inflate a multi-MB blob per request.

**7. Exclude write path**

**[changed during implementation]** The plan assumed `PATCH /api/backups/:shortId` could be reused. It cannot: that body requires `repositoryId` and `cronExpression`, and _defaults_ `maxRetries` and `retryDelay` — so adding a single pattern through it would silently reset a job's retry settings.

Shipped instead as `POST /api/backups/:shortId/exclusions` with `{ patterns: string[] }`, appending server-side. That also removes the read-modify-write race the plan was worried about, rather than just narrowing it.

**8. Regenerate the client** — `bun run gen:api-client` (needs the dev server up; `bun run dev` + `portless get zerobyte`).

## Frontend work

**1. Route** — `app/routes/(dashboard)/repositories/$repositoryId/$snapshotId/index.tsx` gains a `?view=` search param, or a `Tabs` block mirroring `repository-details.tsx:227`: **Files** (today's browser) | **Disk usage** (new).

**2. `app/client/modules/repositories/components/snapshot-usage/`**

- `usage-explorer.tsx` — orchestrates state (current dir, sort, selection)
- `usage-empty-state.tsx` — "Analyse snapshot" CTA; explains it reads every tree blob once and can take a few minutes on a large remote repo, that the result is cached permanently, and that it's cancellable
- `usage-progress.tsx` — subscribes to the task over the existing SSE stream
- `usage-row.tsx` — the `ncdu` line: proportional bar, `<ByteSize>`, `% of parent`, name, file count, newest-mtime, `[Exclude]`
- `usage-breadcrumb.tsx`
- `largest-files-table.tsx`
- `by-extension-table.tsx`
- `exclude-dialog.tsx`

Deliberately _not_ extending `file-tree.tsx`. That component is a lazy expand-in-place tree shared by four browsers; the usage view wants a flat, sorted, one-level-at-a-time list with a different row anatomy. Forcing both into one component makes both worse.

**3. Exclude dialog**

Resolve the owning schedule the way `snapshot-details.tsx:73` already does — `schedules.find(s => snapshot.tags?.includes(s.shortId))`. If nothing matches (a snapshot not produced by a Zerobyte schedule), degrade to "Copy pattern" with an explanation instead of an apply button.

Offer prefilled pattern choices, editable as free text:

| Choice                                 | Pattern for `/var/lib/zerobyte/volumes/ab12/_data/media/raw` |
| -------------------------------------- | ------------------------------------------------------------ |
| This exact path                        | `/var/lib/zerobyte/volumes/ab12/_data/media/raw`             |
| This folder name anywhere              | `**/raw`                                                     |
| This extension everywhere (files only) | `*.iso`                                                      |

Absolute patterns are anchored by restic, and the snapshot node path _is_ the path restic saw at backup time (the volume mount path — `getVolumeMountPath` in `app/client/lib/volume-path.ts`), so the exact-path pattern needs no translation.

Show the resulting diff against the current `excludePatterns`, then `PATCH`. On success, a toast that states the honest consequence:

> Excluded from the next backup. This snapshot and existing ones still contain the data — run _forget_ + _prune_ to reclaim the space.

Multi-select checkboxes on rows → **Exclude N paths** batch action through the same dialog.

## Honest-numbers caveat

Both producers report **original file sizes** — before deduplication and compression, and hardlinked files counted once per link. This is `du --apparent-size` semantics, the same thing `ncdu` shows, and it is the right number for _"should I be backing this up?"_. It is **not** the space consumed in the repository. Put that in a one-line hint under the total, next to the real repo figure from `repositories_table.stats`.

(If open question #1 resolves in our favour, `data_size_in_repo` from `-vv` would give the post-dedup number too, and the view could show both. Don't design around it until it's verified.)

## Edge cases

- **Snapshot with multiple `paths`** — the tree has multiple roots; the explorer opens at a synthetic root listing them, or descends straight in when there's only one. `findCommonAncestor` (`packages/core/src/utils/common-ancestor.ts`) already handles the display prefix.
- **Non-POSIX paths** (Windows-style, already special-cased in `snapshot-file-browser.tsx:42`) — prefix matching must split on both separators, or the stack-pop logic mis-nests.
- **Empty / zero-byte snapshot** — empty state, not an error.
- **Scan cancelled or failed** — no row written; the empty state shows the failure and a retry.
- **Concurrent scans on one repository** — `repoMutex.acquireShared` + the `getLsLimiter` semaphore already serialise this; the task store's active-task lookup prevents duplicate scans of the same snapshot.
- **A path already covered by an existing exclude** — phase 3 (see below); until then the dialog just shows the current list so a duplicate is visible.
- **Backup-time capture on a source that changes mid-walk** — files can vanish between `readdir` and `lstat`. Swallow `ENOENT`/`EACCES` per entry and count them, so the footer can say "42 entries unreadable" rather than the walk dying.
- **Source-side totals won't equal the snapshot's `total_bytes_processed`** — by design: the walk sees excluded paths too. Show both and label the gap as what your excludes are saving.

## Testing

- `packages/core/src/usage/__tests__/fold.test.ts` — the fold, fed synthetic node sequences: nested dirs, deep nesting, multiple roots, zero-byte files, unicode and space-bearing names, a pruned subtree producing the right `truncatedChildren`, adaptive threshold escalation past the cap.
- `packages/core/src/usage/__tests__/walk-source.test.ts` — against a temp directory tree: nested dirs, symlinks not followed, unreadable entries counted not fatal, `oneFileSystem` behaviour, cancellation via `signal`.
- `packages/core/src/restic/commands/__tests__/scan-usage.test.ts` — fixture NDJSON through the same fold, and the `--no-lock` flag present in the argv.
- `app/server/modules/backups/__tests__/` — a failing usage walk does **not** fail the backup, and the walk runs outside the repository lock.
- `app/server/modules/repositories/__tests__/` — endpoint tests: no data, scan running, scan present, drill-down paging, cross-org isolation, and `409` when the repository is opted out of scans.
- `app/client/modules/repositories/components/snapshot-usage/__tests__/` — explorer renders sorted rows, drill-down and breadcrumb, exclude dialog produces the expected patterns for a dir, a file and an extension, the "no owning schedule" degraded path, and the cold-cache warning in the scan dialog.
- A note in `apps/docs/content/docs/concepts/backups.mdx` (or a new `guides/finding-large-files.mdx`) covering the apparent-size caveat, the forget/prune consequence, and what a scan reads from the remote.

## Phasing

**Phase 1 — free data, and the whole ask for new snapshots.** The fold, the source walk, backup-time capture (server + agent), table + migration with gzip and retention, the read endpoints, explorer tab with drill-down and sorted rows, exclude dialog with the three pattern choices, tests, docs. **No repository reads at all in this phase** — which means it ships without any of the metered-backend risk.

**Phase 2 — historical snapshots.** The `restic ls` scan path, as an explicit user action: task kind, scan command, `--no-lock`, the warm/cold disclosure dialog, the per-repository opt-out, and cost reporting. This is the only phase that reads the repository, and it's opt-in per invocation.

**Phase 3 — judgement aids.** Largest-files flat view, by-extension rollup, batch exclude, and an **"already excluded"** badge — evaluate the schedule's current patterns against each path with a restic-compatible matcher. (The matcher is the real work; restic's pattern semantics are not plain glob.)

**Phase 4 — trend.** Diff a snapshot's tree against the previous one for the same schedule: _"`/media/raw` grew 12 GB since Tuesday."_ Nearly free once backup-time capture is running, since every snapshot already has a tree — and it's the strongest possible signal for what to exclude. Optionally a treemap.

Splitting 1 and 2 this way means the feature lands useful and zero-cost first, and the part that can cost money arrives separately with its guards.

## Open questions

1. **Verify restic's `-vv` per-file sizes** (option A above) before building option B, in case we can get `data_size_in_repo` — post-dedup, post-compression bytes — for free. ~10 minutes with a local test repo. If it works, it's strictly better data than either walk produces.
2. **Prune thresholds.** 1 MiB / 0.01% / 50k dirs are opening guesses. Worth measuring against a genuinely large source tree before locking in.
3. **Tree retention default.** "Last 10 snapshots per schedule" is a guess; the right number depends on how much the phase-4 trend view wants to look back.
4. **Entry point from the backup side.** Tuning excludes is a _backup_ activity, but the data hangs off a _snapshot_. Suggest a "Storage usage" action on the backup details page that opens the schedule's latest captured tree.
