import { Effect } from "effect";
import { expect, test, vi } from "vitest";
import waitForExpect from "wait-for-expect";
import { fromPartial } from "@total-typescript/shoehorn";
import { createAgentMessage } from "@zerobyte/contracts/agent-protocol";
import { LOCAL_AGENT_ID } from "../constants";
import {
	backupPayload,
	createSocket,
	getAgentsServiceMocks,
	readyPayload,
	startRuntime,
} from "./controller-runtime.test-utils";

const agentsServiceMocks = getAgentsServiceMocks();

test("rejected and replaced provisional connections do not disconnect an active session", async () => {
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime, onEvent } = await startRuntime(vi.fn());
	const activeSocket = createSocket("connection-active");
	await runtime.openConnection(activeSocket.data, { send: activeSocket.send, close: activeSocket.close });
	await runtime.handleConnectionMessage(
		activeSocket.data.agentId,
		activeSocket.data.id,
		createAgentMessage("agent.ready", readyPayload),
	);
	onEvent.mockClear();
	const firstOpening = createSocket("connection-opening-1");
	const secondOpening = createSocket("connection-opening-2");

	runtime.beginOpeningConnection(firstOpening.data, {
		send: firstOpening.send,
		close: firstOpening.close,
	});
	runtime.beginOpeningConnection(secondOpening.data, {
		send: secondOpening.send,
		close: secondOpening.close,
	});
	await runtime.handleConnectionMessage(
		secondOpening.data.agentId,
		secondOpening.data.id,
		createAgentMessage("agent.ready", readyPayload),
	);
	await runtime.rejectOpeningConnection(secondOpening.data.agentId, secondOpening.data.id, "credential_changed");

	expect(firstOpening.close).toHaveBeenCalledWith(1000, "connection_replaced");
	expect(secondOpening.close).toHaveBeenCalledWith(1008, "credential_changed");
	expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledTimes(1);
	expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "agent.disconnected" }));
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(true);

	await runtime.closeConnection(activeSocket.data.agentId, activeSocket.data.id);
	expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent.disconnected" }));
	await Effect.runPromise(runtime.stop);
});

test("replacement keeps the active connection current until atomic promotion", async () => {
	let resolveOldReady: (() => void) | undefined;
	let storedStatus = "offline";
	const delayedOldReady = new Promise<void>((resolve) => {
		resolveOldReady = resolve;
	});
	agentsServiceMocks.markAgentConnecting.mockImplementation(async () => {
		storedStatus = "connecting";
	});
	agentsServiceMocks.markAgentOnline
		.mockImplementationOnce(async () => {
			await delayedOldReady;
			storedStatus = "online";
		})
		.mockImplementation(async () => {
			storedStatus = "online";
		});
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime, onEvent } = await startRuntime(vi.fn());
	const oldSocket = createSocket("connection-old");
	const newSocket = createSocket("connection-new");
	await runtime.openConnection(oldSocket.data, { send: oldSocket.send, close: oldSocket.close });
	const oldReady = runtime.handleConnectionMessage(
		oldSocket.data.agentId,
		oldSocket.data.id,
		createAgentMessage("agent.ready", readyPayload),
	);
	await waitForExpect(() => expect(agentsServiceMocks.markAgentOnline).toHaveBeenCalledOnce());
	const stalePong = runtime.handleConnectionMessage(
		oldSocket.data.agentId,
		oldSocket.data.id,
		createAgentMessage("heartbeat.pong", { sentAt: 100 }),
	);
	const staleEvent = runtime.handleConnectionMessage(
		oldSocket.data.agentId,
		oldSocket.data.id,
		createAgentMessage("restore.completed", {
			restoreId: "restore-stale",
			organizationId: "org-1",
			repositoryId: "repo-1",
			snapshotId: "snapshot-1",
			result: { message_type: "summary", files_restored: 1, files_skipped: 0 },
		}),
	);
	const replacement = runtime.openConnection(newSocket.data, { send: newSocket.send, close: newSocket.close });
	let replacementSettled = false;
	void replacement.finally(() => {
		replacementSettled = true;
	});

	expect(replacementSettled).toBe(false);
	expect(oldSocket.close).not.toHaveBeenCalled();
	resolveOldReady?.();
	await Promise.all([oldReady, stalePong, staleEvent, replacement]);
	expect(oldSocket.close).toHaveBeenCalledWith(1000, "connection_replaced");
	expect(storedStatus).toBe("connecting");
	await runtime.handleConnectionMessage(
		newSocket.data.agentId,
		newSocket.data.id,
		createAgentMessage("agent.ready", readyPayload),
	);
	await runtime.handleConnectionMessage(
		newSocket.data.agentId,
		newSocket.data.id,
		createAgentMessage("heartbeat.pong", { sentAt: 200 }),
	);
	expect(storedStatus).toBe("online");
	const firstCurrent = runtime.handleConnectionMessage(
		newSocket.data.agentId,
		newSocket.data.id,
		createAgentMessage("restore.completed", {
			restoreId: "restore-current-1",
			organizationId: "org-1",
			repositoryId: "repo-1",
			snapshotId: "snapshot-1",
			result: { message_type: "summary", files_restored: 2, files_skipped: 0 },
		}),
	);
	const secondCurrent = runtime.handleConnectionMessage(
		newSocket.data.agentId,
		newSocket.data.id,
		createAgentMessage("restore.completed", {
			restoreId: "restore-current-2",
			organizationId: "org-1",
			repositoryId: "repo-1",
			snapshotId: "snapshot-1",
			result: { message_type: "summary", files_restored: 3, files_skipped: 0 },
		}),
	);
	await Promise.all([firstCurrent, secondCurrent]);

	expect(agentsServiceMocks.markAgentSeen).toHaveBeenCalledTimes(2);
	const restoreEvents = onEvent.mock.calls
		.map(([event]) => event)
		.filter((event) => event.type === "restore.completed")
		.map((event) => event.payload.restoreId);
	expect(restoreEvents).toEqual(["restore-stale", "restore-current-1", "restore-current-2"]);
	await Effect.runPromise(runtime.stop);
});

test("promotion waits for a current connection closed during its initial retirement check", async () => {
	let releaseOffline: (() => void) | undefined;
	const offlineBlocked = new Promise<void>((resolve) => {
		releaseOffline = resolve;
	});
	const order: string[] = [];
	agentsServiceMocks.markAgentConnecting.mockImplementation(async () => {
		order.push("connecting");
	});
	agentsServiceMocks.markAgentOffline.mockImplementationOnce(async () => {
		await offlineBlocked;
		order.push("offline");
	});
	const onEvent = vi.fn(async (event: { type: string }) => {
		if (event.type === "agent.disconnected") order.push("disconnected");
	});
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime(onEvent);
	try {
		const current = createSocket("connection-closing-during-promotion");
		await runtime.openConnection(current.data, { send: current.send, close: current.close });
		await runtime.handleConnectionMessage(
			current.data.agentId,
			current.data.id,
			createAgentMessage("agent.ready", readyPayload),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		order.length = 0;
		const successor = createSocket("connection-after-concurrent-close");
		runtime.beginOpeningConnection(successor.data, { send: successor.send, close: successor.close });
		const promotion = runtime.promoteOpeningConnection(successor.data.agentId, successor.data.id);
		// Deliver the close callback at promotion's first asynchronous yield, in the same event-loop turn.
		const closing = Promise.resolve().then(() => runtime.closeConnection(current.data.agentId, current.data.id));
		const promoted = vi.fn();
		void promotion.then(promoted, promoted);
		await waitForExpect(() => expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledOnce());
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledOnce();
		expect(promoted).not.toHaveBeenCalled();
		expect(successor.send).not.toHaveBeenCalled();

		releaseOffline?.();
		await expect(closing).resolves.toBe(true);
		await expect(promotion).resolves.toBe(true);
		expect(order).toEqual(["offline", "disconnected", "connecting"]);
		await runtime.handleConnectionMessage(
			successor.data.agentId,
			successor.data.id,
			createAgentMessage("agent.ready", readyPayload),
		);
		await expect(runtime.waitForAgentReady(LOCAL_AGENT_ID, 0)).resolves.toBe(true);
	} finally {
		releaseOffline?.();
		await Effect.runPromise(runtime.stop);
	}
});

test("aborting replacement during the old disconnect event eventually marks the agent offline", async () => {
	let releaseDisconnect: (() => void) | undefined;
	const disconnectBlocked = new Promise<void>((resolve) => {
		releaseDisconnect = resolve;
	});
	let storedStatus = "offline";
	agentsServiceMocks.markAgentConnecting.mockImplementation(async () => {
		storedStatus = "connecting";
	});
	agentsServiceMocks.markAgentOnline.mockImplementation(async () => {
		storedStatus = "online";
	});
	agentsServiceMocks.markAgentOffline.mockImplementation(async () => {
		storedStatus = "offline";
	});
	const onEvent = vi.fn(async (event: { type: string }) => {
		if (event.type === "agent.disconnected") await disconnectBlocked;
	});
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime(onEvent);
	try {
		const current = createSocket("connection-replaced-without-successor");
		await runtime.openConnection(current.data, { send: current.send, close: current.close });
		await runtime.handleConnectionMessage(
			current.data.agentId,
			current.data.id,
			createAgentMessage("agent.ready", readyPayload),
		);
		expect(storedStatus).toBe("online");
		const candidate = createSocket("connection-aborted-during-disconnect");
		const promotion = runtime.openConnection(candidate.data, { send: candidate.send, close: candidate.close });
		await waitForExpect(() =>
			expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent.disconnected" })),
		);
		await expect(
			runtime.rejectOpeningConnection(candidate.data.agentId, candidate.data.id, "credential_changed"),
		).resolves.toBe(true);
		releaseDisconnect?.();
		await expect(promotion).resolves.toBe(false);
		await vi.waitFor(() => expect(storedStatus).toBe("offline"));
		expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledOnce();
		expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledOnce();
		await expect(runtime.waitForAgentReady(LOCAL_AGENT_ID, 0)).resolves.toBe(false);
		await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(false);
	} finally {
		releaseDisconnect?.();
		await Effect.runPromise(runtime.stop);
	}
});

test("aborting replacement wakes readiness waiters when the previous connection resumes", async () => {
	let releaseMessage: (() => void) | undefined;
	const messageBlocked = new Promise<void>((resolve) => {
		releaseMessage = resolve;
	});
	agentsServiceMocks.markAgentSeen.mockReturnValueOnce(messageBlocked);
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime();
	try {
		const current = createSocket("connection-resuming-after-drain");
		await runtime.openConnection(current.data, { send: current.send, close: current.close });
		await runtime.handleConnectionMessage(
			current.data.agentId,
			current.data.id,
			createAgentMessage("agent.ready", readyPayload),
		);
		const message = runtime.handleConnectionMessage(
			current.data.agentId,
			current.data.id,
			createAgentMessage("heartbeat.pong", { sentAt: 1 }),
		);
		await waitForExpect(() => expect(agentsServiceMocks.markAgentSeen).toHaveBeenCalledOnce());
		const candidate = createSocket("connection-rejected-during-drain");
		const promotion = runtime.openConnection(candidate.data, { send: candidate.send, close: candidate.close });
		await vi.waitFor(async () => {
			await expect(runtime.waitForAgentReady(LOCAL_AGENT_ID, 0)).resolves.toBe(false);
		});
		const ready = vi.fn();
		void runtime.waitForAgentReady(LOCAL_AGENT_ID, 10_000).then(ready);
		await runtime.rejectOpeningConnection(candidate.data.agentId, candidate.data.id, "credential_changed");
		expect(ready).not.toHaveBeenCalled();
		releaseMessage?.();
		await message;
		await expect(promotion).resolves.toBe(false);
		await expect(runtime.waitForAgentReady(LOCAL_AGENT_ID, 0)).resolves.toBe(true);
		await vi.waitFor(() => expect(ready).toHaveBeenCalledWith(true), { timeout: 500, interval: 10 });
		expect(current.close).not.toHaveBeenCalled();
		await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(true);
	} finally {
		releaseMessage?.();
		await Effect.runPromise(runtime.stop);
	}
});

test("disconnect during stalled replacement registration closes and drains both generations", async () => {
	let resolveReplacementRegistration: (() => void) | undefined;
	const replacementRegistration = new Promise<void>((resolve) => {
		resolveReplacementRegistration = resolve;
	});
	const statusOrder: string[] = [];
	agentsServiceMocks.markAgentConnecting.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
		await replacementRegistration;
		statusOrder.push("connecting");
	});
	agentsServiceMocks.markAgentOffline.mockImplementation(async () => {
		statusOrder.push("offline");
	});
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime(vi.fn());
	const oldSocket = createSocket("connection-old");
	const newSocket = createSocket("connection-new");
	await runtime.openConnection(oldSocket.data, { send: oldSocket.send, close: oldSocket.close });
	await runtime.handleConnectionMessage(
		oldSocket.data.agentId,
		oldSocket.data.id,
		createAgentMessage("agent.ready", readyPayload),
	);
	oldSocket.send.mockClear();

	const replacement = runtime.openConnection(newSocket.data, { send: newSocket.send, close: newSocket.close });
	await waitForExpect(() => expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledTimes(2));
	expect(oldSocket.close).toHaveBeenCalledWith(1000, "connection_replaced");

	const disconnect = runtime.disconnectAgent(LOCAL_AGENT_ID);
	await waitForExpect(() => expect(newSocket.close).toHaveBeenCalledWith(1000, "disconnected_by_controller"));
	const backup = runtime.sendBackup(LOCAL_AGENT_ID, backupPayload);
	await expect(Effect.runPromise(backup)).resolves.toBe(false);
	const cancelPayload = {
		jobId: backupPayload.jobId,
		scheduleId: backupPayload.scheduleId,
	};
	const cancellation = runtime.cancelBackup(LOCAL_AGENT_ID, cancelPayload);
	await expect(Effect.runPromise(cancellation)).resolves.toBe(false);
	expect(oldSocket.send).not.toHaveBeenCalled();

	resolveReplacementRegistration?.();
	await expect(disconnect).resolves.toBe(true);
	await expect(replacement).resolves.toBe(false);
	expect(statusOrder).toEqual(["offline", "connecting", "offline"]);
	expect(runtime.getAgentCount()).toBe(0);
	await Effect.runPromise(runtime.stop);
});

test("shutdown during stalled replacement registration closes both generations before status release", async () => {
	let resolveReplacementRegistration: (() => void) | undefined;
	const replacementRegistration = new Promise<void>((resolve) => {
		resolveReplacementRegistration = resolve;
	});
	agentsServiceMocks.markAgentConnecting
		.mockResolvedValueOnce(undefined)
		.mockReturnValueOnce(replacementRegistration);
	const stopServer = vi.fn(() => Promise.resolve());
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: stopServer }));
	const { runtime } = await startRuntime(vi.fn());
	const oldSocket = createSocket("connection-old");
	const newSocket = createSocket("connection-new");
	await runtime.openConnection(oldSocket.data, { send: oldSocket.send, close: oldSocket.close });
	await runtime.handleConnectionMessage(
		oldSocket.data.agentId,
		oldSocket.data.id,
		createAgentMessage("agent.ready", readyPayload),
	);

	const replacement = runtime.openConnection(newSocket.data, { send: newSocket.send, close: newSocket.close });
	await waitForExpect(() => expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledTimes(2));
	expect(oldSocket.close).toHaveBeenCalledWith(1000, "connection_replaced");

	const shutdown = Effect.runPromise(runtime.stop);
	await waitForExpect(() => expect(newSocket.close).toHaveBeenCalledWith(1000, "controller_shutdown"));
	resolveReplacementRegistration?.();
	await expect(shutdown).resolves.toBeUndefined();
	await expect(replacement).resolves.toBe(false);
	expect(stopServer).toHaveBeenCalledOnce();
	expect(runtime.getAgentCount()).toBe(0);
});

test("overlapping replaced promotions are abandoned before shutdown without duplicate cleanup", async () => {
	let releaseDisconnect: (() => void) | undefined;
	const disconnectBlocked = new Promise<void>((resolve) => {
		releaseDisconnect = resolve;
	});
	const onEvent = vi.fn(async (event: { type: string }) => {
		if (event.type === "agent.disconnected") await disconnectBlocked;
	});
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime(onEvent);
	const activeSocket = createSocket("connection-active");
	await runtime.openConnection(activeSocket.data, { send: activeSocket.send, close: activeSocket.close });
	const activeClose = runtime.closeConnection(activeSocket.data.agentId, activeSocket.data.id);
	await waitForExpect(() =>
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent.disconnected" })),
	);

	const firstOpening = createSocket("connection-opening-1");
	const replacementOpening = createSocket("connection-opening-2");
	runtime.beginOpeningConnection(firstOpening.data, { send: firstOpening.send, close: firstOpening.close });
	const firstPromotion = runtime.promoteOpeningConnection(firstOpening.data.agentId, firstOpening.data.id);
	const overlappingPromotion = runtime.promoteOpeningConnection(firstOpening.data.agentId, firstOpening.data.id);
	await new Promise((resolve) => setTimeout(resolve, 0));
	runtime.beginOpeningConnection(replacementOpening.data, {
		send: replacementOpening.send,
		close: replacementOpening.close,
	});
	const replacementPromotion = runtime.promoteOpeningConnection(
		replacementOpening.data.agentId,
		replacementOpening.data.id,
	);
	const shutdown = Effect.runPromise(runtime.stop);
	await waitForExpect(() => expect(replacementOpening.close).toHaveBeenCalledWith(1000, "controller_shutdown"));

	releaseDisconnect?.();
	await expect(activeClose).resolves.toBe(true);
	await expect(Promise.all([firstPromotion, overlappingPromotion, replacementPromotion])).resolves.toEqual([
		false,
		false,
		false,
	]);
	await expect(shutdown).resolves.toBeUndefined();
	expect(firstOpening.close).toHaveBeenCalledOnce();
	expect(firstOpening.close).toHaveBeenCalledWith(1000, "connection_replaced");
	expect(replacementOpening.close).toHaveBeenCalledOnce();
	expect(onEvent).toHaveBeenCalledOnce();
	expect(agentsServiceMocks.markAgentOffline).toHaveBeenCalledOnce();
	expect(runtime.getAgentCount()).toBe(0);
	expect(runtime.getRetirementCount()).toBe(0);
	expect(runtime.getLifecycle()).toBe("stopped");
});

test("repeated replacements retire each prior generation without retaining admission state", async () => {
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime(vi.fn());
	const sockets = [
		createSocket("connection-1"),
		createSocket("connection-2"),
		createSocket("connection-3"),
		createSocket("connection-4"),
	];
	const firstSocket = sockets[0];
	if (!firstSocket) throw new Error("Expected a first socket");
	await runtime.openConnection(firstSocket.data, { send: firstSocket.send, close: firstSocket.close });

	for (let index = 1; index < sockets.length; index += 1) {
		const previousSocket = sockets[index - 1];
		const replacementSocket = sockets[index];
		if (!previousSocket || !replacementSocket) throw new Error("Expected replacement sockets");
		await runtime.openConnection(replacementSocket.data, {
			send: replacementSocket.send,
			close: replacementSocket.close,
		});
		expect(previousSocket.close).toHaveBeenCalledOnce();
		expect(previousSocket.close).toHaveBeenCalledWith(1000, "connection_replaced");
		expect(runtime.getAgentCount()).toBe(1);
	}

	await expect(runtime.disconnectAgent(LOCAL_AGENT_ID)).resolves.toBe(true);
	expect(runtime.getAgentCount()).toBe(0);
	await Effect.runPromise(runtime.stop);
});

test("replacement waits for the closing generation retirement before promotion", async () => {
	let releaseDisconnect: (() => void) | undefined;
	const disconnectReleased = new Promise<void>((resolve) => {
		releaseDisconnect = resolve;
	});
	const onEvent = vi.fn(async (event: { type: string }) => {
		if (event.type === "agent.disconnected") await disconnectReleased;
	});
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime(onEvent);
	const oldSocket = createSocket("connection-closing-old");
	const newSocket = createSocket("connection-closing-new");
	const oldTransport = { send: oldSocket.send, close: oldSocket.close };
	await runtime.openConnection(oldSocket.data, oldTransport);
	const oldReadyMessage = createAgentMessage("agent.ready", readyPayload);
	await runtime.handleConnectionMessage(oldSocket.data.agentId, oldSocket.data.id, oldReadyMessage);

	const firstClose = runtime.closeConnection(oldSocket.data.agentId, oldSocket.data.id);
	await waitForExpect(() =>
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent.disconnected" })),
	);
	const repeatedClose = runtime.closeConnection(oldSocket.data.agentId, oldSocket.data.id);
	const newTransport = { send: newSocket.send, close: newSocket.close };
	const replacement = runtime.openConnection(newSocket.data, newTransport);
	const bufferedReadyMessage = createAgentMessage("agent.ready", readyPayload);
	const bufferedReady = runtime.handleConnectionMessage(
		newSocket.data.agentId,
		newSocket.data.id,
		bufferedReadyMessage,
	);
	let replacementSettled = false;
	void replacement.finally(() => {
		replacementSettled = true;
	});
	const queuedBackup = Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload));
	await new Promise((resolve) => setTimeout(resolve, 0));

	expect(runtime.getRetirementCount()).toBe(1);
	expect(replacementSettled).toBe(false);
	expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledTimes(1);
	expect(agentsServiceMocks.markAgentOnline).toHaveBeenCalledTimes(1);
	expect(newSocket.send).not.toHaveBeenCalled();

	releaseDisconnect?.();
	await expect(firstClose).resolves.toBe(true);
	await expect(repeatedClose).resolves.toBe(true);
	await expect(bufferedReady).resolves.toBe(true);
	await expect(replacement).resolves.toBe(true);
	await expect(queuedBackup).resolves.toBe(false);
	expect(runtime.getRetirementCount()).toBe(0);
	expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledTimes(2);
	expect(agentsServiceMocks.markAgentOnline).toHaveBeenCalledTimes(2);
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(true);
	expect(newSocket.send).toHaveBeenCalledWith(expect.stringContaining('"type":"backup.run"'));
	await Effect.runPromise(runtime.stop);
});

test("disconnect rejects an opening and joins promotion waiting for the prior retirement", async () => {
	let releaseDisconnect: (() => void) | undefined;
	const disconnectBlocked = new Promise<void>((resolve) => {
		releaseDisconnect = resolve;
	});
	const onEvent = vi.fn(async (event: { type: string }) => {
		if (event.type === "agent.disconnected") await disconnectBlocked;
	});
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: vi.fn(() => Promise.resolve()) }));
	const { runtime } = await startRuntime(onEvent);
	try {
		const oldSocket = createSocket("connection-retiring-before-disconnect");
		await runtime.openConnection(oldSocket.data, { send: oldSocket.send, close: oldSocket.close });
		const closing = runtime.closeConnection(oldSocket.data.agentId, oldSocket.data.id);
		await waitForExpect(() =>
			expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent.disconnected" })),
		);
		const opening = createSocket("connection-opening-before-disconnect");
		runtime.beginOpeningConnection(opening.data, { send: opening.send, close: opening.close });
		const promotion = runtime.promoteOpeningConnection(opening.data.agentId, opening.data.id);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const disconnect = runtime.disconnectAgent(LOCAL_AGENT_ID);
		const settled = vi.fn();
		void disconnect.then(settled, settled);
		await waitForExpect(() => expect(opening.close).toHaveBeenCalledWith(1000, "disconnected_by_controller"));
		expect(settled).not.toHaveBeenCalled();
		expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledOnce();

		releaseDisconnect?.();
		await expect(closing).resolves.toBe(true);
		await expect(promotion).resolves.toBe(false);
		await expect(disconnect).resolves.toBe(true);
		expect(opening.close).toHaveBeenCalledOnce();
		expect(onEvent).toHaveBeenCalledOnce();
		expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledOnce();
		expect(runtime.getAgentCount()).toBe(0);
		expect(runtime.getRetirementCount()).toBe(0);
	} finally {
		releaseDisconnect?.();
		await Effect.runPromise(runtime.stop);
	}
});

test("revoke and shutdown discover and await an already-retiring generation", async () => {
	let releaseDisconnect: (() => void) | undefined;
	const disconnectReleased = new Promise<void>((resolve) => {
		releaseDisconnect = resolve;
	});
	const onEvent = vi.fn(async (event: { type: string }) => {
		if (event.type === "agent.disconnected") await disconnectReleased;
	});
	const stopServer = vi.fn(() => Promise.resolve());
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: stopServer }));
	const { runtime } = await startRuntime(onEvent);
	const socket = createSocket("connection-retiring");
	const transport = { send: socket.send, close: socket.close };
	await runtime.openConnection(socket.data, transport);

	const close = runtime.closeConnection(socket.data.agentId, socket.data.id);
	await waitForExpect(() =>
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "agent.disconnected" })),
	);
	const revoke = runtime.disconnectAgent(socket.data.agentId);
	const shutdown = Effect.runPromise(runtime.stop);
	let revokeSettled = false;
	let shutdownSettled = false;
	void revoke.finally(() => {
		revokeSettled = true;
	});
	void shutdown.finally(() => {
		shutdownSettled = true;
	});
	await new Promise((resolve) => setTimeout(resolve, 0));

	expect(runtime.getRetirementCount()).toBe(1);
	expect(revokeSettled).toBe(false);
	expect(shutdownSettled).toBe(false);
	expect(stopServer).toHaveBeenCalledWith(false);

	releaseDisconnect?.();
	await expect(close).resolves.toBe(true);
	await expect(revoke).resolves.toBe(true);
	await expect(shutdown).resolves.toBeUndefined();
	expect(runtime.getRetirementCount()).toBe(0);
	expect(runtime.getAgentCount()).toBe(0);
	expect(stopServer).toHaveBeenCalledOnce();
});

test("shutdown rejects a connection injected while retirement is awaited and remains idempotent", async () => {
	let releaseDisconnect: (() => void) | undefined;
	const disconnectBlocked = new Promise<void>((resolve) => {
		releaseDisconnect = resolve;
	});
	const onEvent = vi.fn(async (event: { type: string }) => {
		if (event.type === "agent.disconnected") await disconnectBlocked;
	});
	const stopServer = vi.fn(() => Promise.resolve());
	vi.spyOn(Bun, "serve").mockReturnValue(fromPartial({ port: 3001, stop: stopServer }));
	const { runtime } = await startRuntime(onEvent);
	const active = createSocket("connection-active");
	await runtime.openConnection(active.data, { send: active.send, close: active.close });
	const connectingCalls = agentsServiceMocks.markAgentConnecting.mock.calls.length;

	const firstStop = Effect.runPromise(runtime.stop);
	await waitForExpect(() => expect(runtime.getLifecycle()).toBe("stopping"));
	const concurrentStop = Effect.runPromise(runtime.stop);
	let concurrentStopSettled = false;
	void concurrentStop.then(() => {
		concurrentStopSettled = true;
	});
	const injected = createSocket("connection-injected");
	await expect(runtime.openConnection(injected.data, { send: injected.send, close: injected.close })).resolves.toBe(
		false,
	);
	await expect(runtime.handleConnectionMessage(active.data.agentId, active.data.id, "{}")).resolves.toBe(false);
	await expect(Effect.runPromise(runtime.sendBackup(LOCAL_AGENT_ID, backupPayload))).resolves.toBe(false);
	expect(injected.close).toHaveBeenCalledWith(1008, "controller_stopping");
	expect(agentsServiceMocks.markAgentConnecting).toHaveBeenCalledTimes(connectingCalls);
	expect(concurrentStopSettled).toBe(false);

	releaseDisconnect?.();
	await firstStop;
	await concurrentStop;
	await expect(Effect.runPromise(runtime.stop)).resolves.toBeUndefined();
	expect(runtime.getLifecycle()).toBe("stopped");
	expect(runtime.getRetirementCount()).toBe(0);
	expect(runtime.getAgentCount()).toBe(0);
	expect(stopServer).toHaveBeenCalledOnce();
});
