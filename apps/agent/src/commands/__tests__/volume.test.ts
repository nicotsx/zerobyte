import { afterEach, expect, test, vi } from "vitest";
import { Effect } from "effect";
import { fromPartial } from "@total-typescript/shoehorn";
import {
	parseAgentMessage,
	type AgentWireMessage,
	type VolumeCommandPayload,
} from "@zerobyte/contracts/agent-protocol";
import type { ControllerCommandContext } from "../../context";

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

const runVolumeCommand = async (payload: VolumeCommandPayload) => {
	const outboundMessages: AgentWireMessage[] = [];
	const context = fromPartial<ControllerCommandContext>({
		offerOutbound: (message: AgentWireMessage) =>
			Effect.sync(() => {
				outboundMessages.push(message);
				return true;
			}),
	});

	await Effect.runPromise(handleVolumeCommand(context, payload));
	return outboundMessages.map((message) => parseAgentMessage(message));
};

test("runs backend-backed volume commands on the agent host", async () => {
	const mount = vi.fn(async () => ({ status: "mounted" as const }));
	volumeHostMock.createVolumeBackend.mockReturnValue({ mount });

	const messages = await runVolumeCommand(
		fromPartial<VolumeCommandPayload>({
			commandId: "command-1",
			command: {
				name: "volume.mount",
				volume: {
					id: 1,
					config: { backend: "directory", path: "/tmp/source" },
					provisioningId: undefined,
				},
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
				volume: { id: 1, config: { backend: "directory", path: "/tmp/source" } },
				subPath: "/logs",
				offset: 0,
				limit: 10,
			},
		}),
	);

	expect(operationsMock.listVolumeFiles).toHaveBeenCalledWith(
		expect.objectContaining({ id: 1, config: { backend: "directory", path: "/tmp/source" } }),
		"/logs",
		0,
		10,
	);
});
