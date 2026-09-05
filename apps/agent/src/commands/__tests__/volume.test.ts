import { afterEach, expect, test, vi } from "vitest";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fromPartial } from "@total-typescript/shoehorn";
import {
	parseAgentMessage,
	type AgentWireMessage,
	type VolumeCommandPayload,
} from "@zerobyte/contracts/agent-protocol";
import type { ControllerCommandContext } from "../../context";
import { createAgentExecutionPolicy } from "../../execution-policy";
import { createTrustedRootRegistry } from "../../trusted-roots";

const volumeHostMock = vi.hoisted(() => ({
	createVolumeBackend: vi.fn(),
	getStatFs: vi.fn(),
	getVolumePath: vi.fn(),
}));

const operationsMock = vi.hoisted(() => ({
	browseFilesystem: vi.fn(),
	listVolumeFiles: vi.fn(),
	testVolumeConnection: vi.fn(),
}));

vi.mock("../../volume-host", () => volumeHostMock);
vi.mock("../../volume-host/operations", () => operationsMock);

import { handleVolumeCommand } from "../volume";

afterEach(() => {
	vi.restoreAllMocks();
	volumeHostMock.createVolumeBackend.mockReset();
	volumeHostMock.getStatFs.mockReset();
	volumeHostMock.getVolumePath.mockReset();
	operationsMock.browseFilesystem.mockReset();
	operationsMock.listVolumeFiles.mockReset();
	operationsMock.testVolumeConnection.mockReset();
});

const runVolumeCommand = async (
	payload: VolumeCommandPayload,
	executionPolicy?: ControllerCommandContext["executionPolicy"],
) => {
	const outboundMessages: AgentWireMessage[] = [];
	const builtinRegistry = createTrustedRootRegistry({ builtinLocal: true });
	const builtinPolicy = createAgentExecutionPolicy({ builtinLocal: true, registry: builtinRegistry });
	const selectedExecutionPolicy = executionPolicy ?? builtinPolicy;
	const context = fromPartial<ControllerCommandContext>({
		executionPolicy: selectedExecutionPolicy,
		offerOutbound: (message: AgentWireMessage) =>
			Effect.sync(() => {
				outboundMessages.push(message);
				return true;
			}),
	});

	await Effect.runPromise(handleVolumeCommand(context, payload));
	return outboundMessages.map((message) => parseAgentMessage(message));
};

test.each([
	["mount", { name: "volume.mount", volume: { id: 1, config: { backend: "directory", path: "/tmp" } } }],
	["health", { name: "volume.checkHealth", volume: { id: 1, config: { backend: "directory", path: "/tmp" } } }],
	[
		"managed statfs",
		{
			name: "volume.statfs",
			source: { kind: "managed", volume: { id: 1, config: { backend: "directory", path: "/tmp" } } },
		},
	],
	[
		"managed listing",
		{
			name: "volume.listFiles",
			source: { kind: "managed", volume: { id: 1, config: { backend: "directory", path: "/tmp" } } },
			offset: 0,
			limit: 10,
		},
	],
	["connection test", { name: "volume.testConnection", backendConfig: { backend: "directory", path: "/tmp" } }],
	["absolute browse", { name: "filesystem.browse", path: "/tmp" }],
])("standalone policy rejects %s bypass commands", async (_name, command) => {
	const registry = createTrustedRootRegistry();
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: false, registry });
	const typedCommand = command as VolumeCommandPayload["command"];
	const payload = fromPartial<VolumeCommandPayload>({ commandId: "rejected", command: typedCommand });
	const messages = await runVolumeCommand(payload, executionPolicy);
	const response = messages[0];
	expect(response?.success).toBe(true);
	if (response?.success && response.data.type === "volume.commandResult") {
		expect(response.data.payload.status).toBe("error");
		if (response.data.payload.status === "error") {
			expect(response.data.payload.error).toContain("built-in local");
		}
	}
});

test("standalone policy permits stat and browse through a trusted reference", async () => {
	const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-volume-policy-"));
	const nestedPath = path.join(rootPath, "nested");
	fs.mkdirSync(nestedPath);
	const rawRoots = JSON.stringify([{ id: "data", label: "Data", path: rootPath }]);
	const registry = createTrustedRootRegistry({ rawRoots });
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: false, registry });
	volumeHostMock.getStatFs.mockResolvedValue({ total: 1, used: 0, free: 1 });
	operationsMock.browseFilesystem.mockResolvedValue({ directories: [], path: "nested" });
	operationsMock.listVolumeFiles.mockResolvedValue({
		files: [],
		path: "/",
		offset: 0,
		limit: 10,
		total: 0,
		hasMore: false,
	});

	try {
		const statMessages = await runVolumeCommand(
			{
				commandId: "stat",
				command: {
					name: "volume.statfs",
					source: { kind: "agent-filesystem", reference: { rootId: "data", relativePath: "nested" } },
				},
			},
			executionPolicy,
		);
		const browseMessages = await runVolumeCommand(
			{
				commandId: "browse",
				command: {
					name: "filesystem.browse",
					reference: { rootId: "data", relativePath: "nested" },
				},
			},
			executionPolicy,
		);
		const listMessages = await runVolumeCommand(
			{
				commandId: "list",
				command: {
					name: "volume.listFiles",
					source: { kind: "agent-filesystem", reference: { rootId: "data", relativePath: "nested" } },
					offset: 0,
					limit: 10,
				},
			},
			executionPolicy,
		);
		const canonicalNestedPath = fs.realpathSync.native(nestedPath);
		const canonicalRootPath = fs.realpathSync.native(rootPath);
		expect(statMessages[0]?.success && statMessages[0].data.type === "volume.commandResult").toBe(true);
		expect(browseMessages[0]?.success && browseMessages[0].data.type === "volume.commandResult").toBe(true);
		expect(listMessages[0]?.success && listMessages[0].data.type === "volume.commandResult").toBe(true);
		expect(volumeHostMock.getStatFs).toHaveBeenCalledWith(canonicalNestedPath);
		expect(operationsMock.browseFilesystem).toHaveBeenCalledWith(canonicalNestedPath, canonicalRootPath);
		expect(operationsMock.listVolumeFiles).toHaveBeenCalledWith(
			expect.objectContaining({
				canonicalPath: canonicalNestedPath,
				containmentRootPath: canonicalRootPath,
				responsePathStyle: "source-relative",
			}),
			0,
			10,
		);
	} finally {
		fs.rmSync(rootPath, { recursive: true, force: true });
	}
});

test("runs backend-backed volume commands on the agent host", async () => {
	const mount = vi.fn(async () => ({ status: "mounted" as const }));
	volumeHostMock.createVolumeBackend.mockReturnValue({ mount });

	const messages = await runVolumeCommand(
		fromPartial<VolumeCommandPayload>({
			commandId: "command-1",
			command: {
				name: "volume.mount",
				volume: { id: 1, config: { backend: "directory", path: "/tmp/source" }, provisioningId: null },
			},
		}),
	);

	expect(volumeHostMock.createVolumeBackend).toHaveBeenCalledWith(
		expect.objectContaining({ id: 1, config: { backend: "directory", path: "/tmp/source" }, provisioningId: null }),
	);
	expect(mount).toHaveBeenCalledOnce();
	expect(messages[0]?.success).toBe(true);
	if (messages[0]?.success && messages[0].data.type === "volume.commandResult") {
		expect(messages[0].data.payload).toEqual({
			commandId: "command-1",
			status: "success",
			command: { name: "volume.mount", result: { status: "mounted" } },
		});
	}
});

test("returns command errors without throwing", async () => {
	operationsMock.browseFilesystem.mockRejectedValue(new Error("permission denied"));

	const messages = await runVolumeCommand({
		commandId: "command-2",
		command: { name: "filesystem.browse", path: "/root" },
	});

	expect(messages[0]?.success).toBe(true);
	if (messages[0]?.success && messages[0].data.type === "volume.commandResult") {
		expect(messages[0].data.payload).toEqual({
			commandId: "command-2",
			status: "error",
			error: "permission denied",
		});
	}
});

test.each([
	["an explicit empty registry", "[]"],
	["an explicit non-empty registry", JSON.stringify([{ id: "tmp", label: "Temporary files", path: os.tmpdir() }])],
])("built-in policy with %s rejects legacy raw-path browse but keeps managed operations", async (_name, rawRoots) => {
	const registry = createTrustedRootRegistry({ rawRoots, builtinLocal: true });
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: true, registry });
	volumeHostMock.getStatFs.mockResolvedValue({ total: 1, used: 0, free: 1 });

	const browseMessages = await runVolumeCommand(
		{
			commandId: "raw-browse",
			command: { name: "filesystem.browse", path: "/private" },
		},
		executionPolicy,
	);
	const statMessages = await runVolumeCommand(
		fromPartial<VolumeCommandPayload>({
			commandId: "managed-stat",
			command: {
				name: "volume.statfs",
				source: { kind: "managed", volume: { id: 1, config: { backend: "directory", path: "/tmp" } } },
			},
		}),
		executionPolicy,
	);
	const browseResponse = browseMessages[0];
	const statResponse = statMessages[0];

	expect(operationsMock.browseFilesystem).not.toHaveBeenCalled();
	expect(volumeHostMock.getStatFs).toHaveBeenCalledWith("/tmp");
	expect(browseResponse?.success && browseResponse.data.type === "volume.commandResult").toBe(true);
	if (browseResponse?.success && browseResponse.data.type === "volume.commandResult") {
		expect(browseResponse.data.payload).toMatchObject({
			status: "error",
			error: expect.stringContaining("implicit built-in local filesystem compatibility root"),
		});
	}
	expect(statResponse?.success && statResponse.data.type === "volume.commandResult").toBe(true);
	if (statResponse?.success && statResponse.data.type === "volume.commandResult") {
		expect(statResponse.data.payload.status).toBe("success");
	}
});

test("explicit filesystem root statfs redacts host paths from failures after source resolution", async () => {
	const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-statfs-error-"));
	const rawRoots = JSON.stringify([{ id: "filesystem", label: "Filesystem", path: "/" }]);
	const registry = createTrustedRootRegistry({ rawRoots });
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: false, registry });
	const canonicalRootPath = fs.realpathSync.native(rootPath);
	const relativeRootPath = canonicalRootPath.replace(/^\/+/, "");
	volumeHostMock.getStatFs.mockRejectedValue(
		new Error(`statfs failed for [${canonicalRootPath}], retry "${canonicalRootPath}/secret.db".`),
	);

	try {
		const messages = await runVolumeCommand(
			{
				commandId: "trusted-stat-error",
				command: {
					name: "volume.statfs",
					source: {
						kind: "agent-filesystem",
						reference: { rootId: "filesystem", relativePath: relativeRootPath },
					},
				},
			},
			executionPolicy,
		);
		const response = messages[0];

		expect(response?.success && response.data.type === "volume.commandResult").toBe(true);
		if (response?.success && response.data.type === "volume.commandResult") {
			expect(response.data.payload).toMatchObject({
				status: "error",
				error: expect.stringContaining("Check the agent logs"),
			});
			expect(JSON.stringify(response.data.payload)).not.toContain(canonicalRootPath);
		}
	} finally {
		fs.rmSync(rootPath, { recursive: true, force: true });
	}
});

test("explicit filesystem root browse is presented relative to the selected trusted source", async () => {
	const rawRoots = JSON.stringify([{ id: "filesystem", label: "Filesystem", path: "/" }]);
	const registry = createTrustedRootRegistry({ rawRoots });
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: false, registry });
	operationsMock.browseFilesystem.mockResolvedValue({
		directories: [{ name: "etc", path: "/etc", type: "directory" }],
		path: "/",
	});

	const messages = await runVolumeCommand(
		{
			commandId: "root-browse",
			command: {
				name: "filesystem.browse",
				reference: { rootId: "filesystem", relativePath: "" },
			},
		},
		executionPolicy,
	);
	const response = messages[0];

	expect(operationsMock.browseFilesystem).toHaveBeenCalledWith("/", "/");
	expect(response?.success && response.data.type === "volume.commandResult").toBe(true);
	if (response?.success && response.data.type === "volume.commandResult") {
		expect(response.data.payload).toMatchObject({
			status: "success",
			command: {
				result: {
					path: "trusted-root:",
					directories: [{ name: "etc", path: "trusted-root:etc", type: "directory" }],
				},
			},
		});
	}
});

test("routes file listing commands to host operations", async () => {
	operationsMock.listVolumeFiles.mockResolvedValue({
		files: [],
		path: "/logs",
		offset: 0,
		limit: 10,
		total: 0,
		hasMore: false,
	});

	await runVolumeCommand(
		fromPartial<VolumeCommandPayload>({
			commandId: "command-3",
			command: {
				name: "volume.listFiles",
				source: { kind: "managed", volume: { id: 1, config: { backend: "directory", path: "/tmp/source" } } },
				subPath: "/logs",
				offset: 0,
				limit: 10,
			},
		}),
	);

	expect(operationsMock.listVolumeFiles).toHaveBeenCalledWith(
		expect.objectContaining({
			canonicalPath: "/tmp/source",
			containmentRootPath: "/tmp/source",
			requestedSubPath: "/logs",
			responsePathStyle: "legacy",
		}),
		0,
		10,
	);
});

test("trusted stat, list, and browse return the same path-neutral resolution failure", async () => {
	const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-volume-errors-"));
	const rawRoots = JSON.stringify([{ id: "data", label: "Data", path: rootPath }]);
	const registry = createTrustedRootRegistry({ rawRoots });
	const executionPolicy = createAgentExecutionPolicy({ builtinLocal: false, registry });
	const reference = { rootId: "data", relativePath: "missing" };
	const commands: VolumeCommandPayload["command"][] = [
		{ name: "volume.statfs", source: { kind: "agent-filesystem", reference } },
		{
			name: "volume.listFiles",
			source: { kind: "agent-filesystem", reference },
			offset: 0,
			limit: 10,
		},
		{ name: "filesystem.browse", reference },
	];

	try {
		for (const [index, command] of commands.entries()) {
			const messages = await runVolumeCommand({ commandId: `invalid-${index}`, command }, executionPolicy);
			const response = messages[0];
			expect(response?.success).toBe(true);
			if (response?.success && response.data.type === "volume.commandResult") {
				expect(response.data.payload).toMatchObject({
					status: "error",
					error: "Trusted source path cannot be resolved",
				});
				expect(JSON.stringify(response.data.payload)).not.toContain(rootPath);
			}
		}
		expect(volumeHostMock.getStatFs).not.toHaveBeenCalled();
		expect(operationsMock.listVolumeFiles).not.toHaveBeenCalled();
		expect(operationsMock.browseFilesystem).not.toHaveBeenCalled();
	} finally {
		fs.rmSync(rootPath, { recursive: true, force: true });
	}
});
