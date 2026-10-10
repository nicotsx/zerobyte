import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import {
	parseAgentMessage,
	parseControllerMessage,
	type FilesystemCommand,
	type AgentWireMessage,
} from "@zerobyte/contracts/agent-protocol";
import { handleFilesystemCommand } from "../filesystem";
import { createTrustedRootRegistry } from "../../trusted-roots";
import type { ControllerCommandContext } from "../../context";

test.each([false, true])(
	"trusted filesystem commands preserve paths and confinement with builtinLocal=%s",
	async (builtinLocal) => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-trusted-filesystem-"));
		const outside = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-filesystem-outside-"));
		fs.mkdirSync(path.join(root, "photos"));
		fs.writeFileSync(path.join(root, "photos", "picture.txt"), "hello");
		fs.symlinkSync(outside, path.join(root, "escape"));
		const registry = createTrustedRootRegistry({
			rawRoots: JSON.stringify([{ id: "data", label: "Data", path: root }]),
			builtinLocal,
		});
		const messages: AgentWireMessage[] = [];
		const context = fromPartial<ControllerCommandContext>({
			trustedRoots: registry,
			offerOutbound: (message: AgentWireMessage) =>
				Effect.sync(() => {
					messages.push(message);
					return true;
				}),
		});
		const run = async (command: FilesystemCommand) => {
			await Effect.runPromise(handleFilesystemCommand(context, { commandId: "filesystem-1", command }));
			const message = parseAgentMessage(messages.at(-1)!);
			if (!message?.success || message.data.type !== "filesystem.commandResult")
				throw new Error("Expected filesystem result");
			return message.data.payload;
		};

		try {
			const browse = await run({
				name: "filesystem.browse",
				source: { rootId: "data", relativePath: "" },
			});
			expect(browse).toMatchObject({
				status: "success",
				command: {
					result: { directories: [expect.objectContaining({ name: "photos", path: "photos" })] },
				},
			});
			const files = await run({
				name: "filesystem.listFiles",
				source: { rootId: "data", relativePath: "" },
				subPath: "photos",
				offset: 0,
				limit: 10,
			});
			expect(files).toMatchObject({
				status: "success",
				command: {
					result: {
						path: "photos",
						files: [expect.objectContaining({ path: "photos/picture.txt", size: 5 })],
					},
				},
			});
			await expect(
				run({
					name: "filesystem.statfs",
					source: { rootId: "data", relativePath: "photos" },
				}),
			).resolves.toMatchObject({ status: "success", command: { result: { total: expect.any(Number) } } });
			await expect(
				run({
					name: "filesystem.listFiles",
					source: { rootId: "data", relativePath: "escape" },
					offset: 0,
					limit: 10,
				}),
			).resolves.toMatchObject({ status: "error" });
			await expect(
				run({
					name: "filesystem.listFiles",
					source: { rootId: "data", relativePath: "" },
					subPath: "../outside",
					offset: 0,
					limit: 10,
				}),
			).resolves.toMatchObject({ status: "error" });
			expect(JSON.stringify(messages)).not.toContain(root);
			expect(JSON.stringify(messages)).not.toContain(outside);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
			fs.rmSync(outside, { recursive: true, force: true });
		}
	},
);

test.each([
	{ name: "volume.mount", volume: {} },
	{ name: "volume.unmount", volume: {} },
	{ name: "volume.prepare", volume: {} },
	{ name: "volume.checkHealth", volume: {} },
	{ name: "volume.testConnection", backendConfig: {} },
	{ name: "filesystem.browse", path: "/etc" },
	{ name: "filesystem.browse", source: { kind: "controller-path", path: "/etc" } },
	{
		name: "filesystem.browse",
		source: { kind: "agent-filesystem", reference: { rootId: "data", relativePath: "" } },
	},
])("wire protocol rejects lifecycle operations and bare controller paths: $name", (command) => {
	expect(
		parseControllerMessage(
			JSON.stringify({ type: "filesystem.command", payload: { commandId: "unsafe-1", command } }),
		)?.success,
	).toBe(false);
});

test.each([false, true])(
	"the built-in logical root is available only where configured, builtinLocal=%s",
	async (builtinLocal) => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-managed-filesystem-"));
		fs.mkdirSync(path.join(root, "photos"));
		fs.writeFileSync(path.join(root, "photos", "picture.txt"), "hello");

		const registry = createTrustedRootRegistry({ rawRoots: "[]", builtinLocal });
		const messages: AgentWireMessage[] = [];
		const context = fromPartial<ControllerCommandContext>({
			trustedRoots: registry,
			offerOutbound: (message: AgentWireMessage) =>
				Effect.sync(() => {
					messages.push(message);
					return true;
				}),
		});
		const source = {
			rootId: "local-filesystem",
			relativePath: path.relative(path.parse(process.cwd()).root, root).split(path.sep).join("/"),
		} as const;
		const commands = [
			{ name: "filesystem.statfs", source },
			{ name: "filesystem.browse", source },
			{ name: "filesystem.listFiles", source, subPath: "photos", offset: 0, limit: 10 },
		] satisfies FilesystemCommand[];

		try {
			for (const command of commands) {
				const wire = parseControllerMessage(
					JSON.stringify({ type: "filesystem.command", payload: { commandId: "managed", command } }),
				);
				if (!wire?.success || wire.data.type !== "filesystem.command")
					throw new Error("Expected valid filesystem command");

				await Effect.runPromise(handleFilesystemCommand(context, wire.data.payload));
				const response = parseAgentMessage(messages.at(-1)!);
				if (!response?.success || response.data.type !== "filesystem.commandResult")
					throw new Error("Expected filesystem result");
				const result = response.data.payload;
				if (!builtinLocal) {
					expect(result).toMatchObject({
						status: "error",
						error: expect.stringContaining("Unknown trusted root"),
					});
					continue;
				}

				expect(result.status).toBe("success");
				if (command.name === "filesystem.listFiles") {
					expect(result).toMatchObject({
						command: {
							result: {
								path: "photos",
								files: [{ name: "picture.txt", path: "photos/picture.txt", size: 5 }],
								total: 1,
								hasMore: false,
							},
						},
					});
				} else if (command.name === "filesystem.statfs") {
					expect(result).toMatchObject({
						command: { result: { total: expect.any(Number), free: expect.any(Number) } },
					});
				} else {
					expect(result).toMatchObject({ command: { result: { directories: [{ name: "photos" }] } } });
				}
			}

			if (builtinLocal) {
				await Effect.runPromise(
					handleFilesystemCommand(context, {
						commandId: "escape",
						command: { name: "filesystem.listFiles", source, subPath: "../outside", offset: 0, limit: 10 },
					}),
				);
				expect(parseAgentMessage(messages.at(-1)!)?.data).toMatchObject({
					payload: {
						status: "error",
						error: "The agent could not complete the filesystem operation. Check the agent logs for details.",
					},
				});
			}
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	},
);
