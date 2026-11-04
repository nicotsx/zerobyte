import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import { parseAgentMessage, type RestoreRunPayload } from "@zerobyte/contracts/agent-protocol";
import * as resticServer from "@zerobyte/core/restic/server";
import { handleRestoreCancelCommand } from "../restore-cancel";
import { handleControllerCommand } from "../index";
import { handleRestoreRunCommand } from "../restore";
import type { ControllerCommandContext, RunningJob } from "../../context";
import { createTrustedRootRegistry } from "../../trusted-roots";
import { resticDeps } from "../../restic/deps";

// Trusted root and outside path live under the working directory, outside the agent's blocked restore targets.
const trustedRootPath = fs.mkdtempSync(path.join(process.cwd(), "restore-trusted-root-"));
const outsidePath = path.join(process.cwd(), "restore-outside");

afterAll(() => {
	fs.rmSync(trustedRootPath, { recursive: true, force: true });
});

afterEach(() => {
	vi.restoreAllMocks();
});

const createRegistry = () =>
	createTrustedRootRegistry({
		roots: [{ id: "restores", label: "Restores", path: trustedRootPath, allowBackup: true, allowRepository: true }],
	});

const createRunPayload = (overrides: Partial<RestoreRunPayload> = {}) =>
	fromPartial<RestoreRunPayload>({
		restoreId: "restore-1",
		organizationId: "org-1",
		repositoryId: "repo-1",
		snapshotId: "snapshot-1",
		target: path.join(trustedRootPath, "restore-target"),
		repositoryConfig: { backend: "local", path: path.join(trustedRootPath, "repository") },
		runtime: { password: "password" },
		options: { organizationId: "org-1" },
		...overrides,
	});

const createContext = () => {
	const outboundMessages: string[] = [];
	const runningJobs = new Map<string, RunningJob>();

	const context: ControllerCommandContext = {
		trustedRoots: createRegistry(),
		resticDeps,
		getRunningJob: (jobId) => Effect.succeed(runningJobs.get(jobId)),
		setRunningJob: (jobId, job) =>
			Effect.sync(() => {
				runningJobs.set(jobId, job);
			}),
		deleteRunningJob: (jobId) =>
			Effect.sync(() => {
				runningJobs.delete(jobId);
			}),
		offerOutbound: (message) =>
			Effect.sync(() => {
				outboundMessages.push(message);
				return true;
			}),
	};

	return { context, runningJobs, messages: () => outboundMessages.map((message) => parseAgentMessage(message)) };
};

const summary = {
	message_type: "summary" as const,
	files_restored: 2,
	files_skipped: 1,
	bytes_skipped: 0,
};

test("runs restore.run on an agent whose roots do not include the builtin root", async () => {
	const restic = vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			restore: () => Effect.succeed(summary),
		}),
	);
	const payload = createRunPayload();
	const { context, runningJobs, messages } = createContext();

	await Effect.runPromise(
		Effect.gen(function* () {
			yield* handleControllerCommand(context, { type: "restore.run", payload });
			yield* Effect.promise(() =>
				waitForExpect(() => {
					expect(runningJobs.has(payload.restoreId)).toBe(false);
				}),
			);
		}),
	);

	expect(restic).toHaveBeenCalled();
	expect(messages().flatMap((message) => (message?.success ? [message.data.type] : []))).toEqual([
		"restore.started",
		"restore.completed",
	]);
});

test("cancels a running restore with the shared running job registry", async () => {
	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			restore: (_config: unknown, _snapshotId: string, _target: string, options: { signal?: AbortSignal }) =>
				Effect.tryPromise(
					() =>
						new Promise<never>((_resolve, reject) => {
							if (options.signal?.aborted) return reject(new Error("aborted"));
							options.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
								once: true,
							});
						}),
				),
		}),
	);
	const payload = createRunPayload();
	const { context, runningJobs, messages } = createContext();

	await Effect.runPromise(
		Effect.gen(function* () {
			yield* handleRestoreRunCommand(context, payload);
			yield* Effect.promise(() =>
				waitForExpect(() => {
					expect(runningJobs.get(payload.restoreId)?.kind).toBe("restore");
				}),
			);

			yield* handleRestoreCancelCommand(context, { restoreId: payload.restoreId });

			yield* Effect.promise(() =>
				waitForExpect(() => {
					expect(runningJobs.has(payload.restoreId)).toBe(false);
					expect(
						messages().some((message) => message?.success && message.data.type === "restore.cancelled"),
					).toBe(true);
				}),
			);
		}),
	);
});

const outsideRootsMessage =
	"Path must be absolute and inside one of this machine's trusted roots (ZEROBYTE_AGENT_ROOTS)";
const outsideRepositoryRootsMessage =
	'Repositories must be inside a trusted root that allows them ("allowRepository": true in ZEROBYTE_AGENT_ROOTS)';

test.each([
	["a target inside a trusted root", { target: path.join(trustedRootPath, "restore-target") }, true],
	["a target outside every trusted root", { target: path.join(outsidePath, "restore-target") }, false],
	[
		"original location with includes inside a trusted root",
		{
			target: "/",
			options: { organizationId: "org-1", include: [path.join(trustedRootPath, "photos")] },
		},
		true,
	],
	[
		"original location with an include outside every trusted root",
		{
			target: "/",
			options: {
				organizationId: "org-1",
				include: [path.join(trustedRootPath, "photos"), path.join(outsidePath, "private")],
			},
		},
		false,
	],
	[
		"original location with a basePath inside a trusted root and no includes",
		{ target: "/", options: { organizationId: "org-1", basePath: path.join(trustedRootPath, "photos") } },
		true,
	],
	[
		"original location with a basePath outside every trusted root and no includes",
		{ target: "/", options: { organizationId: "org-1", basePath: outsidePath } },
		false,
	],
	["original location without includes or basePath", { target: "/", options: { organizationId: "org-1" } }, false],
	[
		"a repository outside every trusted root",
		{ repositoryConfig: { backend: "local" as const, path: path.join(outsidePath, "repository") } },
		false,
	],
])("restore with %s is accepted: %s", async (_name, overrides, accepted) => {
	const restic = vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			restore: () => Effect.succeed(summary),
		}),
	);
	const payload = createRunPayload(overrides as Partial<RestoreRunPayload>);
	const { context, runningJobs, messages } = createContext();

	await Effect.runPromise(
		Effect.gen(function* () {
			yield* handleRestoreRunCommand(context, payload);
			yield* Effect.promise(() =>
				waitForExpect(() => {
					expect(runningJobs.has(payload.restoreId)).toBe(false);
				}),
			);
		}),
	);

	const failure = messages().find((message) => message?.success && message.data.type === "restore.failed");

	if (accepted) {
		expect(restic).toHaveBeenCalled();
		expect(failure).toBeUndefined();
		expect(messages().flatMap((message) => (message?.success ? [message.data.type] : []))).toEqual([
			"restore.started",
			"restore.completed",
		]);
	} else {
		expect(restic).not.toHaveBeenCalled();
		expect(failure).toEqual(
			expect.objectContaining({
				success: true,
				data: {
					type: "restore.failed",
					payload: expect.objectContaining({
						restoreId: payload.restoreId,
						error: "repositoryConfig" in overrides ? outsideRepositoryRootsMessage : outsideRootsMessage,
					}),
				},
			}),
		);
	}
});

test("rejects a target that reaches a blocked directory through a symlink inside a trusted root", async () => {
	const blockedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "restore-blocked-"));
	const link = path.join(trustedRootPath, "temporary-files");
	fs.symlinkSync(blockedDirectory, link, "dir");
	const restic = vi
		.spyOn(resticServer, "createRestic")
		.mockReturnValue(fromPartial({ restore: () => Effect.succeed(summary) }));
	const payload = createRunPayload({ target: link });
	const { context, runningJobs, messages } = createContext();
	// A root as broad as "/" contains the blocked directories, so only the blocked-target check can stop this.
	context.trustedRoots = createTrustedRootRegistry({
		roots: [{ id: "all", label: "All", path: "/", allowBackup: true, allowRepository: true }],
	});

	try {
		await Effect.runPromise(
			Effect.gen(function* () {
				yield* handleRestoreRunCommand(context, payload);
				yield* Effect.promise(() =>
					waitForExpect(() => {
						expect(runningJobs.has(payload.restoreId)).toBe(false);
					}),
				);
			}),
		);

		expect(restic).not.toHaveBeenCalled();
		expect(messages().find((message) => message?.success && message.data.type === "restore.failed")?.data).toEqual({
			type: "restore.failed",
			payload: expect.objectContaining({ error: expect.stringContaining("Restore target path is not allowed") }),
		});
	} finally {
		fs.rmSync(link);
		fs.rmSync(blockedDirectory, { recursive: true, force: true });
	}
});

const runRejectedRestore = async (payload: RestoreRunPayload, trustedRoots = createRegistry()) => {
	const restic = vi
		.spyOn(resticServer, "createRestic")
		.mockReturnValue(fromPartial({ restore: () => Effect.succeed(summary) }));
	const { context, runningJobs, messages } = createContext();
	context.trustedRoots = trustedRoots;

	await Effect.runPromise(
		Effect.gen(function* () {
			yield* handleRestoreRunCommand(context, payload);
			yield* Effect.promise(() =>
				waitForExpect(() => {
					expect(runningJobs.has(payload.restoreId)).toBe(false);
				}),
			);
		}),
	);

	expect(restic).not.toHaveBeenCalled();
	return messages().find((message) => message?.success && message.data.type === "restore.failed")?.data;
};

const repositoryOverlapFailure = {
	type: "restore.failed",
	payload: expect.objectContaining({
		error: "Restore target path must not overlap the repository being restored from",
	}),
};

test.each([
	["a custom target", { target: path.dirname(os.tmpdir()) }],
	[
		"an original location include",
		{ target: "/", options: { organizationId: "org-1", include: [path.dirname(os.tmpdir())] } },
	],
	["an original location basePath", { target: "/", options: { organizationId: "org-1", basePath: "/" } }],
])("rejects %s that contains a blocked directory", async (_name, overrides) => {
	// A root as broad as "/" contains the blocked directories, so only the blocked-target check can stop this.
	const trustedRoots = createTrustedRootRegistry({
		roots: [{ id: "all", label: "All", path: "/", allowBackup: true, allowRepository: true }],
	});

	expect(await runRejectedRestore(createRunPayload(overrides as Partial<RestoreRunPayload>), trustedRoots)).toEqual({
		type: "restore.failed",
		payload: expect.objectContaining({ error: expect.stringContaining("Restore target path is not allowed") }),
	});
});

test.each([
	["the repository itself", path.join(trustedRootPath, "repository")],
	["a directory inside the repository", path.join(trustedRootPath, "repository", "data")],
	["a directory containing the repository", trustedRootPath],
])("rejects a restore into %s", async (_name, target) => {
	expect(await runRejectedRestore(createRunPayload({ target }))).toEqual(repositoryOverlapFailure);
});

test("rejects a restore into a repository named by its trusted root", async () => {
	const payload = createRunPayload({
		target: path.join(trustedRootPath, "relative-repository"),
		repositoryConfig: { backend: "local", trustedRootId: "restores", path: "relative-repository" },
	});

	expect(await runRejectedRestore(payload)).toEqual(repositoryOverlapFailure);
});
