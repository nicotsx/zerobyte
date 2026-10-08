import { AgentCommandFailed } from "../../agents/agents-manager";
import { Effect } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { volumesTable } from "~/server/db/schema";
import { withContext } from "~/server/core/request-context";
import { agentManager } from "../../agents/agents-manager";
import { createTrustedFilesystemSource } from "../../volumes/__tests__/trusted-filesystem-source.fixture";
import { createTestSession } from "~/test/helpers/auth";
import { createTestRepository } from "~/test/helpers/repository";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { backupExecutor } from "../backup-executor";

afterEach(() => vi.restoreAllMocks());

test("keeps the captured source and machine together when a queued source is edited", async () => {
	const { organizationId } = await createTestSession();
	const original = await createTrustedFilesystemSource(organizationId);
	const replacement = await createTrustedFilesystemSource(organizationId);
	const repository = await createTestRepository({
		organizationId,
		type: "s3",
		config: {
			backend: "s3",
			endpoint: "https://s3.example.com",
			bucket: "backups",
			accessKeyId: "test-key",
			secretAccessKey: "test-secret",
		},
	});
	const schedule = await createTestBackupSchedule({
		organizationId,
		volumeId: original.volume.id,
		repositoryId: repository.id,
	});

	await db
		.update(volumesTable)
		.set({ agentId: replacement.agentId, relativePath: "new/location" })
		.where(eq(volumesTable.id, original.volume.id));

	const readiness = vi.spyOn(agentManager, "isAgentReady").mockReturnValue(false);
	const preflight = vi
		.spyOn(agentManager, "runFilesystemCommand")
		.mockReturnValue(Effect.fail(new AgentCommandFailed({ message: "Unexpected backup preflight" })));
	const dispatch = vi
		.spyOn(agentManager, "runBackup")
		.mockResolvedValue({ status: "completed", exitCode: 0, result: null, warningDetails: null });

	await withContext({ organizationId }, () =>
		backupExecutor.execute({
			jobId: "queued-source-change",
			scheduleId: schedule.id,
			schedule,
			volume: original.volume,
			repository,
			organizationId,
			signal: new AbortController().signal,
			onProgress: () => {},
		}),
	);

	expect(dispatch.mock.calls[0]?.[1].payload.source).toEqual({ rootId: "photos", relativePath: "family" });
	expect(dispatch.mock.calls[0]?.[0]).toBe(original.agentId);
	expect(preflight).not.toHaveBeenCalled();
	expect(readiness).not.toHaveBeenCalled();
	expect(await db.query.volumesTable.findFirst({ where: { id: original.volume.id } })).toMatchObject({
		agentId: replacement.agentId,
		relativePath: "new/location",
	});
});
