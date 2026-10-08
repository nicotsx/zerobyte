import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { createControllerMessage, parseAgentMessage, type FilesystemCommand } from "@zerobyte/contracts/agent-protocol";
import { createControllerSession } from "../controller-session";
import * as resticServer from "@zerobyte/core/restic/server";
import { createTrustedRootRegistry } from "../trusted-roots";
import { createRunPayload } from "../commands/__tests__/backup-run.harness";

vi.mock("node:fs/promises", async (original) => ({ ...(await original<typeof fs>()) }));

afterEach(() => vi.restoreAllMocks());

test("the local session returns filesystem listing, browse and stats through the protocol", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-local-session-filesystem-"));
	await fs.mkdir(path.join(root, "photos"));
	await fs.writeFile(path.join(root, "photos", "picture.txt"), "hello");

	const messages: string[] = [];
	const trustedRoots = createTrustedRootRegistry({ rawRoots: "[]", builtinLocal: true });
	const session = createControllerSession(fromPartial({ send: (message: string) => messages.push(message) }), {
		trustedRoots,
		builtinLocal: true,
	});
	const commands = [
		{
			name: "filesystem.listFiles",
			source: {
				rootId: "local-filesystem",
				relativePath: path.relative(path.parse(process.cwd()).root, root).split(path.sep).join("/"),
			},
			subPath: "photos",
			offset: 0,
			limit: 10,
		},
		{
			name: "filesystem.browse",
			source: {
				rootId: "local-filesystem",
				relativePath: path.relative(path.parse(process.cwd()).root, root).split(path.sep).join("/"),
			},
		},
		{
			name: "filesystem.statfs",
			source: {
				rootId: "local-filesystem",
				relativePath: path.relative(path.parse(process.cwd()).root, root).split(path.sep).join("/"),
			},
		},
	] satisfies FilesystemCommand[];

	try {
		for (const command of commands) {
			session.onMessage(createControllerMessage("filesystem.command", { commandId: command.name, command }));
		}

		await vi.waitFor(() => expect(messages).toHaveLength(3));
		const responses = messages.map((message) => parseAgentMessage(message)?.data);
		expect(responses).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					payload: expect.objectContaining({
						status: "success",
						command: {
							name: "filesystem.listFiles",
							result: expect.objectContaining({
								path: "photos",
								files: [expect.objectContaining({ path: "photos/picture.txt", size: 5 })],
							}),
						},
					}),
				}),
				expect.objectContaining({
					payload: expect.objectContaining({
						status: "success",
						command: {
							name: "filesystem.browse",
							result: expect.objectContaining({
								directories: [expect.objectContaining({ name: "photos" })],
							}),
						},
					}),
				}),
				expect.objectContaining({
					payload: expect.objectContaining({
						status: "success",
						command: {
							name: "filesystem.statfs",
							result: { total: expect.any(Number), used: expect.any(Number), free: expect.any(Number) },
						},
					}),
				}),
			]),
		);
	} finally {
		session.close();
		await fs.rm(root, { recursive: true, force: true });
	}
});

test.each(["source resolution", "filesystem read"])(
	"a pending %s permits heartbeat and backup cancellation and suppresses late results after close",
	async (operation) => {
		let resolveSource!: (value: string) => void;
		const pendingSource = new Promise<string>((resolve) => {
			resolveSource = resolve;
		});

		let resolveRead!: (value: Awaited<ReturnType<typeof fs.statfs>>) => void;
		const pendingRead = new Promise<Awaited<ReturnType<typeof fs.statfs>>>((resolve) => {
			resolveRead = resolve;
		});
		const pendingOperation =
			operation === "source resolution"
				? vi.spyOn(fs, "realpath").mockReturnValueOnce(pendingSource)
				: vi.spyOn(fs, "statfs").mockReturnValue(pendingRead);

		const backupAborted = vi.fn();
		vi.spyOn(resticServer, "createRestic").mockReturnValue(
			fromPartial({
				backup: (_config: unknown, _source: string, options: { signal?: AbortSignal }) =>
					Effect.async<never, Error>((resume) => {
						options.signal?.addEventListener(
							"abort",
							() => {
								backupAborted();
								resume(Effect.fail(new Error("Backup was cancelled")));
							},
							{ once: true },
						);
					}),
			}),
		);

		const messages: string[] = [];
		const trustedRoots = createTrustedRootRegistry({ rawRoots: "[]", builtinLocal: true });
		const session = createControllerSession(fromPartial({ send: (message: string) => messages.push(message) }), {
			trustedRoots,
			builtinLocal: true,
		});

		try {
			session.onMessage(
				createControllerMessage("filesystem.command", {
					commandId: "pending",
					command: {
						name: "filesystem.statfs",
						source: {
							rootId: "local-filesystem",
							relativePath: path
								.relative(path.parse(process.cwd()).root, os.tmpdir())
								.split(path.sep)
								.join("/"),
						},
					},
				}),
			);
			await vi.waitFor(() => expect(pendingOperation).toHaveBeenCalledOnce());

			session.onMessage(
				createControllerMessage("backup.run", {
					jobId: "pending-backup",
					scheduleId: "schedule-1",
					organizationId: "org-1",
					source: {
						rootId: "local-filesystem",
						relativePath: path
							.relative(path.parse(process.cwd()).root, os.tmpdir())
							.split(path.sep)
							.join("/"),
					},
					repositoryConfig: { backend: "local", path: "/tmp/repository" },
					options: {
						oneFileSystem: false,
						excludePatterns: null,
						excludeIfPresent: null,
						includePaths: null,
						includePatterns: null,
						customResticParams: null,
						compressionMode: "auto",
					},
					runtime: { password: "password" },
					webhooks: { pre: null, post: null },
					webhookAllowedOrigins: [],
					webhookTimeoutMs: 60_000,
				}),
			);
			await vi.waitFor(() =>
				expect(messages.map((message) => parseAgentMessage(message)?.data?.type)).toContain("backup.started"),
			);

			session.onMessage(
				createControllerMessage("backup.cancel", { jobId: "pending-backup", scheduleId: "schedule-1" }),
			);
			session.onMessage(createControllerMessage("heartbeat.ping", { sentAt: 123 }));
			await vi.waitFor(() => {
				expect(backupAborted).toHaveBeenCalledOnce();
				expect(messages.map((message) => parseAgentMessage(message)?.data)).toEqual(
					expect.arrayContaining([
						{ type: "heartbeat.pong", payload: { sentAt: 123 } },
						expect.objectContaining({ type: "backup.cancelled" }),
					]),
				);
			});

			session.close();
			resolveSource(os.tmpdir());
			resolveRead({
				type: 0n,
				bsize: 1n,
				frsize: 1n,
				blocks: 100n,
				bfree: 90n,
				bavail: 90n,
				files: 1n,
				ffree: 1n,
			});
			await Promise.all([pendingSource, pendingRead]);
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(messages.map((message) => parseAgentMessage(message)?.data?.type)).not.toContain(
				"filesystem.commandResult",
			);
		} finally {
			session.close();
		}
	},
);

test("a pending backup source resolution permits heartbeat and cancellation before Restic starts", async () => {
	let resolveSource!: (value: string) => void;
	const pendingSource = new Promise<string>((resolve) => {
		resolveSource = resolve;
	});
	const realpath = vi.spyOn(fs, "realpath").mockReturnValueOnce(pendingSource);
	const backup = vi.fn(() => Effect.succeed({ exitCode: 0, result: null, warningDetails: null }));
	vi.spyOn(resticServer, "createRestic").mockReturnValue(fromPartial({ backup }));

	const messages: string[] = [];
	const root = os.tmpdir();
	const trustedRoots = createTrustedRootRegistry({
		rawRoots: JSON.stringify([{ id: "data", label: "Data", path: root }]),
	});
	const canonicalRoot = trustedRoots.get("data")!.canonicalPath;
	const session = createControllerSession(fromPartial({ send: (message: string) => messages.push(message) }), {
		trustedRoots,
	});
	const payload = createRunPayload({ source: { rootId: "data", relativePath: "" } });

	try {
		session.onMessage(createControllerMessage("backup.run", payload));
		await vi.waitFor(() => expect(realpath).toHaveBeenCalledOnce());
		session.onMessage(createControllerMessage("heartbeat.ping", { sentAt: 123 }));
		session.onMessage(
			createControllerMessage("backup.cancel", { jobId: payload.jobId, scheduleId: payload.scheduleId }),
		);

		await vi.waitFor(() =>
			expect(messages.map((message) => parseAgentMessage(message)?.data)).toContainEqual({
				type: "heartbeat.pong",
				payload: { sentAt: 123 },
			}),
		);
		resolveSource(canonicalRoot);

		await vi.waitFor(() =>
			expect(messages.map((message) => parseAgentMessage(message)?.data?.type)).toContain("backup.cancelled"),
		);
		expect(backup).not.toHaveBeenCalled();
	} finally {
		resolveSource(canonicalRoot);
		session.close();
	}
});
