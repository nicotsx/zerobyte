import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Scheduler } from "../../../core/scheduler";
import * as agentsModule from "../../agents/agents-manager";
import type { ProcessWithApplicationLifecycleRuntime } from "../bootstrap-runtime";
import { createTestVolume } from "~/test/helpers/volume";
import { db } from "~/server/db/db";
import { volumeService } from "~/server/modules/volumes/volume.service";

const loadShutdownModule = async () => {
	const moduleUrl = new URL("../shutdown.ts", import.meta.url);
	moduleUrl.searchParams.set("test", crypto.randomUUID());
	return import(moduleUrl.href);
};

const runtimeProcess = process as ProcessWithApplicationLifecycleRuntime;

beforeEach(() => {
	delete runtimeProcess.__zerobyteApplicationLifecycleRuntime;
});

afterEach(() => {
	delete runtimeProcess.__zerobyteApplicationLifecycleRuntime;
	vi.restoreAllMocks();
});

test("unmounts saved local managed volumes before stopping their agent without changing stored intent", async () => {
	const events: string[] = [];
	const localManaged = await createTestVolume({ name: "Shutdown local managed", status: "mounted" });
	const remoteManaged = await createTestVolume({
		name: "Shutdown remote managed",
		agentId: "remote-agent",
		status: "mounted",
	});
	const remoteFilesystem = await createTestVolume({
		name: "Shutdown remote filesystem",
		agentId: "remote-agent",
		sourceKind: "agent-filesystem",
		config: null,
		type: null,
		trustedRootId: "photos",
		relativePath: "",
		autoRemount: false,
		status: "mounted",
	});
	vi.spyOn(Scheduler, "stop").mockImplementation(async () => {
		events.push("scheduler.stop");
	});
	vi.spyOn(agentsModule, "stopAgentController").mockImplementation(async () => {
		events.push("agents.stop");
	});
	const unmountVolume = vi.spyOn(volumeService, "unmountVolume").mockImplementation(async (shortId) => {
		events.push(`volume.unmount:${shortId}`);
		return { status: "unmounted", error: undefined };
	});

	const { shutdown } = await loadShutdownModule();

	await shutdown();

	expect(events).toEqual(["scheduler.stop", `volume.unmount:${localManaged.shortId}`, "agents.stop"]);
	expect(unmountVolume).toHaveBeenCalledWith(localManaged.shortId, { persistStatus: false });
	expect(unmountVolume).not.toHaveBeenCalledWith(remoteManaged.shortId, expect.anything());
	expect(unmountVolume).not.toHaveBeenCalledWith(remoteFilesystem.shortId, expect.anything());
	const updated = await db.query.volumesTable.findFirst({ where: { id: localManaged.id } });
	expect(updated?.status).toBe("mounted");
});
