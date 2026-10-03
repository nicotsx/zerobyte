import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VolumeHealthCheckJob } from "~/server/jobs/healthchecks";
import { VolumeAutoRemountJob } from "~/server/jobs/auto-remount";
import { afterEach, describe, expect, test, vi } from "vitest";
const agentManagerMock = vi.hoisted(() => ({
	runVolumeCommand: vi.fn(),
}));

vi.mock("../../agents/agents-manager", () => ({
	agentManager: agentManagerMock,
}));

import { volumeService } from "../volume.service";
import { db } from "~/server/db/db";
import { volumesTable } from "~/server/db/schema";
import { randomUUID } from "node:crypto";
import { createTestSession } from "~/test/helpers/auth";
import { withContext } from "~/server/core/request-context";
import { asShortId } from "~/server/utils/branded";
import { createTestVolume } from "~/test/helpers/volume";
import { config } from "~/server/core/config";
import { cryptoUtils } from "~/server/utils/crypto";

const unreadableSmbConfig = {
	backend: "smb" as const,
	server: "nas",
	share: "backups",
	username: "backup",
	password: "encv1:unreadable",
	port: 445,
	vers: "3.0" as const,
	mapToContainerUidGid: false,
};

afterEach(() => {
	config.flags.enableLocalAgent = false;
	vi.restoreAllMocks();
	agentManagerMock.runVolumeCommand.mockReset();
});

describe("volumeService.getVolume", () => {
	test("should find volume by shortId", async () => {
		const { organizationId, user } = await createTestSession();

		const [volume] = await db
			.insert(volumesTable)
			.values({
				shortId: asShortId(randomUUID().slice(0, 8)),
				name: `test-vol-${randomUUID().slice(0, 8)}`,
				type: "directory",
				status: "mounted",
				config: { backend: "directory", path: "/" },
				autoRemount: true,
				organizationId,
			})
			.returning();

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.getVolume(volume.shortId);
			expect(result.volume.id).toBe(volume.id);
			expect(result.volume.shortId).toBe(volume.shortId);
		});
	});

	test("should find volume by shortId from literal input", async () => {
		const { organizationId, user } = await createTestSession();

		const [volume] = await db
			.insert(volumesTable)
			.values({
				shortId: asShortId("test1234"),
				name: `test-vol-${randomUUID().slice(0, 8)}`,
				type: "directory",
				status: "mounted",
				config: { backend: "directory", path: "/" },
				autoRemount: true,
				organizationId,
			})
			.returning();

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.getVolume(volume.shortId);
			expect(result.volume.id).toBe(volume.id);
			expect(result.volume.shortId).toBe(volume.shortId);
		});
	});

	test("should find volume by numeric-looking shortId", async () => {
		const { organizationId, user } = await createTestSession();

		const [volume] = await db
			.insert(volumesTable)
			.values({
				shortId: asShortId("499780"),
				name: `test-vol-${randomUUID().slice(0, 8)}`,
				type: "directory",
				status: "mounted",
				config: { backend: "directory", path: "/" },
				autoRemount: true,
				organizationId,
			})
			.returning();

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.getVolume(asShortId("499780"));
			expect(result.volume.id).toBe(volume.id);
			expect(result.volume.shortId).toBe(asShortId("499780"));
		});
	});

	test("should throw NotFoundError for non-existent volume", async () => {
		const { organizationId, user } = await createTestSession();

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(volumeService.getVolume(asShortId("nonexistent"))).rejects.toThrow("Volume not found");
		});
	});

	test("gets statfs without decrypting stored credentials", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({
			organizationId,
			status: "mounted",
			agentId: "agent-1",
			type: "smb",
			config: unreadableSmbConfig,
		});
		agentManagerMock.runVolumeCommand.mockResolvedValue({
			name: "volume.statfs",
			result: { total: 100, used: 40, free: 60 },
		});
		vi.spyOn(cryptoUtils, "resolveSecret").mockRejectedValue(
			new Error("Unsupported state or unable to authenticate data"),
		);

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.getVolume(volume.shortId);

			expect(result.statfs).toEqual({ total: 100, used: 40, free: 60 });
		});
		expect(cryptoUtils.resolveSecret).not.toHaveBeenCalled();
	});
});

describe("volumeService.listFiles security", () => {
	test("should reject traversal outside the volume root in listFiles", async () => {
		const { organizationId, user } = await createTestSession();
		agentManagerMock.runVolumeCommand.mockRejectedValue(new Error("Invalid path"));

		const [volume] = await db
			.insert(volumesTable)
			.values({
				shortId: asShortId(randomUUID().slice(0, 8)),
				name: `test-vol-${randomUUID().slice(0, 8)}`,
				type: "directory",
				status: "mounted",
				config: { backend: "directory", path: "/tmp/volume" },
				autoRemount: true,
				organizationId,
			})
			.returning();

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(volumeService.listFiles(volume.shortId, "../volume-secret")).rejects.toThrow("Invalid path");
		});
	});
});

describe("volumeService.mountVolume", () => {
	test("routes unmount and mount to the owning agent before updating state", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({
			organizationId,
			status: "mounted",
			agentId: "agent-1",
			type: "nfs",
			config: { backend: "nfs", server: "nas", exportPath: "/data", version: "4", port: 2049, readOnly: false },
		});
		agentManagerMock.runVolumeCommand
			.mockResolvedValueOnce({ name: "volume.unmount", result: { status: "unmounted" } })
			.mockResolvedValueOnce({ name: "volume.mount", result: { status: "mounted" } });

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.mountVolume(volume.shortId);

			expect(result.status).toBe("mounted");
			expect(agentManagerMock.runVolumeCommand).toHaveBeenNthCalledWith(
				1,
				volume.agentId,
				expect.objectContaining({ name: "volume.unmount", volume: expect.objectContaining({ id: volume.id }) }),
			);
			expect(agentManagerMock.runVolumeCommand).toHaveBeenNthCalledWith(
				2,
				volume.agentId,
				expect.objectContaining({ name: "volume.mount", volume: expect.objectContaining({ id: volume.id }) }),
			);
		});
	});

	test("does not unmount when stored credentials cannot be decrypted", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({
			organizationId,
			status: "error",
			agentId: "agent-1",
			type: "smb",
			config: unreadableSmbConfig,
		});
		vi.spyOn(cryptoUtils, "resolveSecret").mockRejectedValue(
			new Error("Unsupported state or unable to authenticate data"),
		);

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(volumeService.mountVolume(volume.shortId)).rejects.toThrow(
				"Unsupported state or unable to authenticate data",
			);
		});
		expect(agentManagerMock.runVolumeCommand).not.toHaveBeenCalled();
	});
});

describe("volumeService.updateVolume", () => {
	test("can replace a volume secret when the previous secret cannot be decrypted", async () => {
		const { organizationId, user } = await createTestSession();
		const replacementCiphertext = "encv1:replacement";
		const volume = await createTestVolume({
			organizationId,
			status: "mounted",
			agentId: "agent-1",
			type: "smb",
			config: unreadableSmbConfig,
		});
		agentManagerMock.runVolumeCommand
			.mockResolvedValueOnce({ name: "volume.unmount", result: { status: "unmounted" } })
			.mockResolvedValueOnce({ name: "volume.mount", result: { status: "mounted" } });
		vi.spyOn(cryptoUtils, "sealSecret").mockResolvedValue(replacementCiphertext);
		vi.spyOn(cryptoUtils, "resolveSecret").mockImplementation(async (value) => {
			if (value === unreadableSmbConfig.password) {
				throw new Error("Unsupported state or unable to authenticate data");
			}
			if (value === replacementCiphertext) {
				return "new-password";
			}
			return value;
		});

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(
				volumeService.updateVolume(volume.shortId, {
					config: {
						backend: "smb",
						server: "nas",
						share: "backups",
						username: "backup",
						password: "new-password",
						port: 445,
						vers: "3.0",
						mapToContainerUidGid: false,
					},
				}),
			).resolves.toBeDefined();
		});

		expect(agentManagerMock.runVolumeCommand).toHaveBeenNthCalledWith(
			1,
			volume.agentId,
			expect.objectContaining({
				name: "volume.unmount",
				volume: expect.objectContaining({
					config: expect.objectContaining({ password: unreadableSmbConfig.password }),
				}),
			}),
		);
		expect(agentManagerMock.runVolumeCommand).toHaveBeenNthCalledWith(
			2,
			volume.agentId,
			expect.objectContaining({
				name: "volume.mount",
				volume: expect.objectContaining({ config: expect.objectContaining({ password: "new-password" }) }),
			}),
		);

		const updatedVolume = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
		expect(updatedVolume).toMatchObject({ status: "mounted" });
		expect(updatedVolume?.config).toMatchObject({ password: replacementCiphertext });
	});

	test("preserves unchanged stored credentials without resealing or remounting", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({
			organizationId,
			status: "mounted",
			agentId: "agent-1",
			type: "smb",
			config: unreadableSmbConfig,
		});
		vi.spyOn(cryptoUtils, "sealSecret").mockRejectedValue(
			new Error("Unsupported state or unable to authenticate data"),
		);

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(
				volumeService.updateVolume(volume.shortId, { name: "Renamed volume", config: volume.config }),
			).resolves.toBeDefined();
		});

		expect(cryptoUtils.sealSecret).not.toHaveBeenCalled();
		expect(agentManagerMock.runVolumeCommand).not.toHaveBeenCalled();
		const updatedVolume = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
		expect(updatedVolume).toMatchObject({ name: "Renamed volume", config: volume.config });
	});

	test("does not unmount when preparing changed credentials fails", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({
			organizationId,
			status: "mounted",
			agentId: "agent-1",
			type: "smb",
			config: unreadableSmbConfig,
		});
		vi.spyOn(cryptoUtils, "sealSecret").mockRejectedValue(new Error("Failed to encrypt replacement credential"));

		await withContext({ organizationId, userId: user.id }, async () => {
			await expect(
				volumeService.updateVolume(volume.shortId, {
					config: { ...unreadableSmbConfig, password: "new-password" },
				}),
			).rejects.toThrow("Failed to encrypt replacement credential");
		});

		expect(agentManagerMock.runVolumeCommand).not.toHaveBeenCalled();
	});
});

describe("volumeService.unmountVolume", () => {
	test("persists the unmounted status for normal unmount requests", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({
			organizationId,
			status: "mounted",
			agentId: "agent-1",
			type: "nfs",
			config: { backend: "nfs", server: "nas", exportPath: "/data", version: "4", port: 2049, readOnly: false },
		});
		agentManagerMock.runVolumeCommand.mockResolvedValueOnce({
			name: "volume.unmount",
			result: { status: "unmounted" },
		});

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.unmountVolume(volume.shortId);

			expect(result.status).toBe("unmounted");
			expect(agentManagerMock.runVolumeCommand).toHaveBeenCalledWith(
				volume.agentId,
				expect.objectContaining({ name: "volume.unmount", volume: expect.objectContaining({ id: volume.id }) }),
			);
		});

		const updatedVolume = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
		expect(updatedVolume?.status).toBe("unmounted");
	});
});

describe("volumeService.ensureHealthyVolume", () => {
	test("returns ready when the mounted volume passes its health check", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({
			organizationId,
			status: "mounted",
			agentId: "agent-1",
			type: "nfs",
			config: { backend: "nfs", server: "nas", exportPath: "/data", version: "4", port: 2049, readOnly: false },
		});
		agentManagerMock.runVolumeCommand.mockResolvedValue({
			name: "volume.checkHealth",
			result: { status: "mounted" },
		});

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.ensureHealthyVolume(volume.shortId);

			expect(result).toEqual({
				ready: true,
				volume: expect.objectContaining({ id: volume.id, status: "mounted", lastError: null }),
				remounted: false,
			});
			expect(agentManagerMock.runVolumeCommand).toHaveBeenCalledOnce();
			expect(agentManagerMock.runVolumeCommand).toHaveBeenCalledWith(
				volume.agentId,
				expect.objectContaining({
					name: "volume.checkHealth",
					volume: expect.objectContaining({ id: volume.id }),
				}),
			);
		});
	});

	test("auto-remounts when the mounted volume fails its health check", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({
			organizationId,
			status: "mounted",
			type: "nfs",
			config: { backend: "nfs", server: "nas", exportPath: "/data", version: "4", port: 2049, readOnly: false },
			autoRemount: true,
			agentId: "agent-1",
		});
		agentManagerMock.runVolumeCommand
			.mockResolvedValueOnce({ name: "volume.checkHealth", result: { status: "error", error: "stale mount" } })
			.mockResolvedValueOnce({ name: "volume.unmount", result: { status: "unmounted" } })
			.mockResolvedValueOnce({ name: "volume.mount", result: { status: "mounted" } });

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.ensureHealthyVolume(volume.shortId);

			expect(result).toEqual({
				ready: true,
				volume: expect.objectContaining({ id: volume.id, status: "mounted", lastError: null }),
				remounted: true,
			});
			expect(agentManagerMock.runVolumeCommand).toHaveBeenCalledTimes(3);

			const updatedVolume = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
			expect(updatedVolume?.status).toBe("mounted");
			expect(updatedVolume?.lastError).toBeNull();
		});
	});

	test("returns not ready when the health check fails and auto-remount is disabled", async () => {
		const { organizationId, user } = await createTestSession();
		const volume = await createTestVolume({
			organizationId,
			status: "mounted",
			type: "nfs",
			config: { backend: "nfs", server: "nas", exportPath: "/data", version: "4", port: 2049, readOnly: false },
			autoRemount: false,
			agentId: "agent-1",
		});
		agentManagerMock.runVolumeCommand.mockResolvedValue({
			name: "volume.checkHealth",
			result: { status: "error", error: "stale mount" },
		});

		await withContext({ organizationId, userId: user.id }, async () => {
			const result = await volumeService.ensureHealthyVolume(volume.shortId);

			expect(result).toEqual({
				ready: false,
				volume: expect.objectContaining({ id: volume.id, status: "error", lastError: "stale mount" }),
				reason: "stale mount",
			});
			expect(agentManagerMock.runVolumeCommand).toHaveBeenCalledOnce();
		});
	});
});

describe("volumeService.testConnection", () => {
	test("decrypts stored credentials before routing test connections to the local agent", async () => {
		config.flags.enableLocalAgent = true;
		const password = await cryptoUtils.sealSecret("stored-password");
		agentManagerMock.runVolumeCommand.mockResolvedValue({
			name: "volume.testConnection",
			result: { success: true, message: "Connection successful" },
		});

		await expect(
			volumeService.testConnection({
				backend: "smb",
				server: "nas",
				share: "backups",
				username: "backup",
				password,
				port: 445,
				vers: "3.0",
				mapToContainerUidGid: false,
			}),
		).resolves.toEqual({
			success: true,
			message: "Connection successful",
		});

		expect(agentManagerMock.runVolumeCommand).toHaveBeenCalledWith(
			"local",
			expect.objectContaining({
				name: "volume.testConnection",
				backendConfig: expect.objectContaining({ password: "stored-password" }),
			}),
		);
	});
});

test.each(["unmounted", "error"] as const)(
	"recovers a directory saved as %s even when auto-remount is disabled",
	async (status) => {
		config.flags.enableLocalAgent = false;
		const { organizationId } = await createTestSession();
		const tempRoot = await mkdtemp(join(tmpdir(), "zerobyte-directory-recovery-"));
		const directoryPath = join(tempRoot, "folder");
		try {
			const volume = await createTestVolume({
				organizationId,
				status,
				autoRemount: false,
				config: { backend: "directory", path: directoryPath },
			});
			await withContext({ organizationId }, async () => {
				const unavailable = await volumeService.ensureHealthyVolume(volume.shortId);
				expect(unavailable.ready).toBe(false);
				expect(unavailable.volume.status).toBe("error");
				await mkdir(directoryPath);
				const recovered = await volumeService.ensureHealthyVolume(volume.shortId);
				expect(recovered).toMatchObject({
					ready: true,
					remounted: false,
					volume: { status: "mounted", lastError: null },
				});
				const unmounted = await volumeService.unmountVolume(volume.shortId);
				expect(unmounted.status).toBe("mounted");
				await rm(directoryPath, { recursive: true });
				await writeFile(directoryPath, "This is a file, not a folder.");
				const replacedWithFile = await volumeService.ensureHealthyVolume(volume.shortId);
				expect(replacedWithFile).toMatchObject({ ready: false, reason: "Path is not a directory" });
			});
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
		}
	},
);

test("periodic health checks recover old unmounted directories without mounting network volumes", async () => {
	config.flags.enableLocalAgent = false;
	const { organizationId } = await createTestSession();
	const folderPath = await mkdtemp(join(tmpdir(), "zerobyte-directory-health-job-"));
	try {
		const directory = await createTestVolume({
			organizationId,
			status: "unmounted",
			autoRemount: false,
			config: { backend: "directory", path: folderPath },
		});
		const networkVolume = await createTestVolume({
			organizationId,
			status: "unmounted",
			type: "nfs",
			config: { backend: "nfs", server: "nas", exportPath: "/data", version: "4", port: 2049, readOnly: false },
			agentId: "remote-agent",
		});
		await new VolumeHealthCheckJob().run();
		const recovered = await db.query.volumesTable.findFirst({ where: { id: directory.id } });
		const network = await db.query.volumesTable.findFirst({ where: { id: networkVolume.id } });
		expect(recovered).toMatchObject({ status: "mounted", lastError: null });
		expect(network?.status).toBe("unmounted");
		expect(agentManagerMock.runVolumeCommand).not.toHaveBeenCalledWith("remote-agent", expect.anything());
		await rm(folderPath, { recursive: true });
		await withContext({ organizationId }, () => volumeService.checkHealth(directory.shortId));
		await mkdir(folderPath);
		await new VolumeAutoRemountJob().run();
		const recoveredAgain = await db.query.volumesTable.findFirst({ where: { id: directory.id } });
		expect(recoveredAgain).toMatchObject({ status: "mounted", autoRemount: false, lastError: null });
	} finally {
		await rm(folderPath, { recursive: true, force: true });
	}
});
