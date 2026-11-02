import * as fs from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import {
	parseAgentMessage,
	RESTIC_COMMAND_RESULT_CHUNK_SIZE,
	type ResticCommandPayload,
} from "@zerobyte/contracts/agent-protocol";
import * as resticServer from "@zerobyte/core/restic/server";
import { ResticError } from "@zerobyte/core/restic/server";
import { handleResticCancelCommand } from "../restic-cancel";
import { handleResticCommand } from "../restic-command";
import { handleResticResultAckCommand } from "../restic-result-ack";
import type { ControllerCommandContext, RunningJob } from "../../context";
import { createTrustedRootRegistry } from "../../trusted-roots";
import { resticDeps } from "../../restic/deps";

// Trusted root and outside path live under the working directory, outside the agent's blocked restore targets.
const trustedRootPath = fs.mkdtempSync(path.join(process.cwd(), "restic-command-trusted-root-"));
const outsidePath = path.join(process.cwd(), "restic-command-outside");

afterAll(() => {
	fs.rmSync(trustedRootPath, { recursive: true, force: true });
});

afterEach(() => {
	vi.restoreAllMocks();
});

const createRunPayload = (overrides: Partial<ResticCommandPayload> = {}) =>
	fromPartial<ResticCommandPayload>({
		commandId: "command-1",
		organizationId: "org-1",
		repositoryConfig: { backend: "local", path: path.join(trustedRootPath, "repository") },
		runtime: { password: "password" },
		command: { name: "restic.stats" },
		...overrides,
	});

// Acks every chunk like the controller does, unless a test drives the acks itself.
const createContext = ({ ackChunks = true } = {}) => {
	const outboundMessages: string[] = [];
	const runningJobs = new Map<string, RunningJob>();

	const context: ControllerCommandContext = {
		trustedRoots: createTrustedRootRegistry({
			roots: [
				{
					id: "repositories",
					label: "Repositories",
					path: trustedRootPath,
					allowBackup: true,
					allowRepository: true,
				},
			],
		}),
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
			Effect.gen(function* () {
				outboundMessages.push(message);

				const parsed = parseAgentMessage(message);
				if (ackChunks && parsed?.success && parsed.data.type === "restic.commandResult") {
					const { commandId, status } = parsed.data.payload;
					if (status === "chunk") yield* handleResticResultAckCommand(context, { commandId });
				}

				return true;
			}),
	};

	const messages = () => outboundMessages.map((message) => parseAgentMessage(message));
	const resultPayloads = () =>
		messages().flatMap((message) =>
			message?.success && message.data.type === "restic.commandResult" ? [message.data.payload] : [],
		);
	const commandMessages = () =>
		messages().flatMap((message) =>
			message?.success && message.data.type === "restic.commandMessage" ? [message.data.payload] : [],
		);

	return { context, runningJobs, resultPayloads, commandMessages };
};

const runCommand = (
	payload: ResticCommandPayload,
	context: ControllerCommandContext,
	runningJobs: Map<string, RunningJob>,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			yield* handleResticCommand(context, payload);
			yield* Effect.promise(() =>
				waitForExpect(() => {
					expect(runningJobs.has(payload.commandId)).toBe(false);
				}),
			);
		}),
	);

const reassemble = (payloads: Array<{ status: string; data?: string }>) => {
	const terminal = payloads.at(-1);
	const chunks = payloads.slice(0, -1).map((payload) => payload.data ?? "");
	return JSON.parse(chunks.join("") + (terminal?.data ?? ""));
};

test("returns a large result as ordered chunks followed by the terminal success", async () => {
	const result = { data: "x".repeat(RESTIC_COMMAND_RESULT_CHUNK_SIZE * 2 + 1) };
	vi.spyOn(resticServer, "createRestic").mockReturnValue(fromPartial({ stats: () => Effect.succeed(result) }));
	const payload = createRunPayload();
	const { context, runningJobs, resultPayloads } = createContext();

	await runCommand(payload, context, runningJobs);

	const payloads = resultPayloads();
	expect(payloads.map((resultPayload) => resultPayload.status)).toEqual(["chunk", "chunk", "success"]);
	expect(payloads.every((resultPayload) => resultPayload.commandId === payload.commandId)).toBe(true);
	expect(
		payloads
			.slice(0, -1)
			.every(
				(resultPayload) =>
					resultPayload.status === "chunk" && resultPayload.data.length === RESTIC_COMMAND_RESULT_CHUNK_SIZE,
			),
	).toBe(true);
	expect(reassemble(payloads)).toEqual(result);
});

test("keeps surrogate pairs intact across chunk boundaries", async () => {
	// JSON text starts with `{"data":"` (9 characters), so this places a surrogate pair straddling the first boundary.
	const result = { data: "a".repeat(RESTIC_COMMAND_RESULT_CHUNK_SIZE - 10) + "😀" + "a".repeat(10) };
	vi.spyOn(resticServer, "createRestic").mockReturnValue(fromPartial({ stats: () => Effect.succeed(result) }));
	const payload = createRunPayload();
	const { context, runningJobs, resultPayloads } = createContext();

	await runCommand(payload, context, runningJobs);

	const payloads = resultPayloads();
	for (const resultPayload of payloads) {
		const data = "data" in resultPayload ? resultPayload.data : "";
		expect(new TextDecoder().decode(new TextEncoder().encode(data))).toBe(data);
	}
	expect(reassemble(payloads)).toEqual(result);
});

test("forwards copy progress messages and returns the copy result", async () => {
	const destinationConfig = { backend: "local" as const, path: path.join(trustedRootPath, "destination") };
	const copy = vi.fn(
		(_source: unknown, _destination: unknown, options: { onMessage?: (message: string) => void }) => {
			options.onMessage?.("copying snapshot 1");
			return Effect.succeed({ copied: 1 });
		},
	);
	vi.spyOn(resticServer, "createRestic").mockReturnValue(fromPartial({ copy }));
	const payload = createRunPayload({
		command: { name: "restic.copy", destinationConfig },
	});
	const { context, runningJobs, resultPayloads, commandMessages } = createContext();

	await runCommand(payload, context, runningJobs);

	expect(commandMessages()).toEqual([{ commandId: payload.commandId, message: "copying snapshot 1" }]);
	expect(resultPayloads()).toEqual([{ commandId: payload.commandId, status: "success", data: '{"copied":1}' }]);
	expect(copy).toHaveBeenCalledWith(
		payload.repositoryConfig,
		destinationConfig,
		expect.objectContaining({ organizationId: "org-1" }),
	);
});

test("maps restic failures to an error carrying the exit code and details", async () => {
	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({ stats: () => Effect.fail(new ResticError(12, "wrong key")) }),
	);
	const payload = createRunPayload();
	const { context, runningJobs, resultPayloads } = createContext();

	await runCommand(payload, context, runningJobs);

	expect(resultPayloads()).toEqual([
		expect.objectContaining({
			commandId: payload.commandId,
			status: "error",
			error: expect.stringContaining("Wrong repository password"),
			resticExitCode: 12,
			details: "wrong key",
		}),
	]);
});

test("reports non-restic failures as a plain error without an exit code", async () => {
	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({ stats: () => Effect.fail(new Error("disk is gone")) }),
	);
	const payload = createRunPayload();
	const { context, runningJobs, resultPayloads } = createContext();

	await runCommand(payload, context, runningJobs);

	expect(resultPayloads()).toEqual([{ commandId: payload.commandId, status: "error", error: "disk is gone" }]);
});

test("cancels a running restic command through its abort signal", async () => {
	vi.spyOn(resticServer, "createRestic").mockReturnValue(
		fromPartial({
			snapshots: (_config: unknown, options: { signal?: AbortSignal }) =>
				Effect.tryPromise(
					() =>
						new Promise<never>((_resolve, reject) => {
							options.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
								once: true,
							});
						}),
				),
		}),
	);
	const payload = createRunPayload({ command: { name: "restic.snapshots" } });
	const { context, runningJobs, resultPayloads } = createContext();

	await Effect.runPromise(
		Effect.gen(function* () {
			yield* handleResticCommand(context, payload);
			yield* Effect.promise(() =>
				waitForExpect(() => {
					expect(runningJobs.get(payload.commandId)?.kind).toBe("restic");
				}),
			);

			yield* handleResticCancelCommand(context, { commandId: payload.commandId });

			yield* Effect.promise(() =>
				waitForExpect(() => {
					expect(runningJobs.has(payload.commandId)).toBe(false);
					expect(resultPayloads()).toEqual([
						{ commandId: payload.commandId, status: "error", error: "Restic command was cancelled" },
					]);
				}),
			);
		}),
	);
});

test("sends each further chunk only after the controller acks the previous one", async () => {
	const result = { data: "x".repeat(RESTIC_COMMAND_RESULT_CHUNK_SIZE * 2 + 1) };
	vi.spyOn(resticServer, "createRestic").mockReturnValue(fromPartial({ stats: () => Effect.succeed(result) }));
	const payload = createRunPayload();
	const { context, runningJobs, resultPayloads } = createContext({ ackChunks: false });
	const statuses = () => resultPayloads().map((resultPayload) => resultPayload.status);

	await Effect.runPromise(
		Effect.gen(function* () {
			yield* handleResticCommand(context, payload);
			yield* Effect.promise(() => waitForExpect(() => expect(statuses()).toEqual(["chunk"])));
			yield* Effect.sleep("50 millis");
			expect(statuses()).toEqual(["chunk"]);

			yield* handleResticResultAckCommand(context, { commandId: payload.commandId });
			yield* Effect.promise(() => waitForExpect(() => expect(statuses()).toEqual(["chunk", "chunk"])));

			yield* handleResticResultAckCommand(context, { commandId: payload.commandId });
			yield* Effect.promise(() =>
				waitForExpect(() => {
					expect(statuses()).toEqual(["chunk", "chunk", "success"]);
					expect(runningJobs.has(payload.commandId)).toBe(false);
				}),
			);
		}),
	);

	expect(reassemble(resultPayloads())).toEqual(result);
});

test("stops waiting for a chunk ack when the command is cancelled", async () => {
	const result = { data: "x".repeat(RESTIC_COMMAND_RESULT_CHUNK_SIZE * 2 + 1) };
	vi.spyOn(resticServer, "createRestic").mockReturnValue(fromPartial({ stats: () => Effect.succeed(result) }));
	const payload = createRunPayload();
	const { context, runningJobs, resultPayloads } = createContext({ ackChunks: false });

	await Effect.runPromise(
		Effect.gen(function* () {
			yield* handleResticCommand(context, payload);
			yield* Effect.promise(() => waitForExpect(() => expect(resultPayloads()).toHaveLength(1)));

			yield* handleResticCancelCommand(context, { commandId: payload.commandId });

			yield* Effect.promise(() =>
				waitForExpect(() => {
					expect(runningJobs.has(payload.commandId)).toBe(false);
					expect(resultPayloads().at(-1)).toEqual({
						commandId: payload.commandId,
						status: "error",
						error: "Restic command was cancelled",
					});
				}),
			);
		}),
	);
});

test.each([
	[
		"a repository outside every trusted root",
		{ repositoryConfig: { backend: "local" as const, path: path.join(outsidePath, "repository") } },
	],
	[
		"a copy destination outside every trusted root",
		{
			command: {
				name: "restic.copy" as const,
				destinationConfig: { backend: "local" as const, path: path.join(outsidePath, "destination") },
			},
		},
	],
])("rejects %s before running restic", async (_name, overrides) => {
	const createRestic = vi.spyOn(resticServer, "createRestic");
	const payload = createRunPayload(overrides as Partial<ResticCommandPayload>);
	const { context, runningJobs, resultPayloads } = createContext();

	await runCommand(payload, context, runningJobs);

	expect(createRestic).not.toHaveBeenCalled();
	expect(resultPayloads()).toEqual([
		expect.objectContaining({
			commandId: payload.commandId,
			status: "error",
			error: expect.stringContaining("Repositories must be inside a trusted root that allows them"),
		}),
	]);
});
