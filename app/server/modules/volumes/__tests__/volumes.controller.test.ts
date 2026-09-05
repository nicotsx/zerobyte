import { beforeAll, describe, expect, test, vi } from "vitest";
import { db } from "~/server/db/db";
import { agentsTable, volumesTable } from "~/server/db/schema";
import { createApp } from "~/server/app";
import { createTestSession, getAuthHeaders } from "~/test/helpers/auth";
import { generateShortId } from "~/server/utils/id";
import { agentManager } from "~/server/modules/agents/agents-manager";
import { presentedVolumeDetailSchema, presentedVolumeSchema } from "@zerobyte/contracts/volumes";
import { eq } from "drizzle-orm";
import { agentsService } from "~/server/modules/agents/agents.service";
import { LOCAL_AGENT_ID, LOCAL_AGENT_NAME } from "~/server/modules/agents/constants";
import { BUILTIN_COMPATIBILITY_ROOT_ID } from "../../../../../apps/agent/src/trusted-roots";

const app = createApp();

let session: Awaited<ReturnType<typeof createTestSession>>;
beforeAll(async () => {
	session = await createTestSession();
});

const createManagedVolumeRecord = async (organizationId: string) => {
	const [volume] = await db
		.insert(volumesTable)
		.values({
			shortId: generateShortId(),
			provisioningId: `provisioned:${organizationId}:${generateShortId()}`,
			name: `Managed-${Date.now()}`,
			type: "directory",
			status: "mounted",
			config: {
				backend: "directory",
				path: "/tmp",
			},
			autoRemount: true,
			organizationId,
		})
		.returning();

	return volume;
};

const createAgentFilesystemVolumeRecord = async (
	organizationId: string,
	status: "mounted" | "unmounted" | "error" = "mounted",
) => {
	const [volume] = await db
		.insert(volumesTable)
		.values({
			shortId: generateShortId(),
			name: `Agent source-${crypto.randomUUID()}`,
			type: null,
			status,
			config: null,
			autoRemount: false,
			agentId: `agent-${crypto.randomUUID()}`,
			sourceKind: "agent-filesystem",
			trustedRootId: "photos",
			relativePath: "family",
			organizationId,
		})
		.returning();

	return volume;
};

const createOnlineAgentFilesystemVolumeRecord = async (organizationId: string) => {
	const volume = await createAgentFilesystemVolumeRecord(organizationId, "error");
	await db.insert(agentsTable).values({
		id: volume.agentId,
		organizationId,
		name: "Online NAS",
		kind: "remote",
		status: "online",
		capabilities: {
			trustedRoots: [{ id: "photos", label: "Photos", canBackup: true }],
		},
	});
	return volume;
};

describe("volumes security", () => {
	test("should return 401 if no session cookie is provided", async () => {
		const res = await app.request("/api/v1/volumes");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Invalid or expired session");
	});

	test("should return 401 if session is invalid", async () => {
		const res = await app.request("/api/v1/volumes", {
			headers: getAuthHeaders("invalid-session"),
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Invalid or expired session");
	});

	test("should return 200 if session is valid", async () => {
		const res = await app.request("/api/v1/volumes", {
			headers: session.headers,
		});

		expect(res.status).toBe(200);
	});

	describe("unauthenticated access", () => {
		const endpoints: { method: string; path: string }[] = [
			{ method: "GET", path: "/api/v1/volumes" },
			{ method: "GET", path: "/api/v1/volumes/source-machines" },
			{ method: "POST", path: "/api/v1/volumes" },
			{ method: "POST", path: "/api/v1/volumes/test-connection" },
			{ method: "DELETE", path: "/api/v1/volumes/test-volume" },
			{ method: "GET", path: "/api/v1/volumes/test-volume" },
			{ method: "PUT", path: "/api/v1/volumes/test-volume" },
			{ method: "POST", path: "/api/v1/volumes/test-volume/mount" },
			{ method: "POST", path: "/api/v1/volumes/test-volume/unmount" },
			{ method: "POST", path: "/api/v1/volumes/test-volume/health-check" },
			{ method: "GET", path: "/api/v1/volumes/test-volume/files" },
			{ method: "GET", path: "/api/v1/volumes/filesystem/browse" },
		];

		for (const { method, path } of endpoints) {
			test(`${method} ${path} should return 401`, async () => {
				const res = await app.request(path, { method });
				expect(res.status).toBe(401);
				const body = await res.json();
				expect(body.message).toBe("Invalid or expired session");
			});
		}
	});

	describe("source machine discovery", () => {
		test("keeps the built-in local agent out of remote source discovery", async () => {
			await agentsService.ensureLocalAgent();

			const res = await app.request("/api/v1/volumes/source-machines", { headers: session.headers });
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: LOCAL_AGENT_ID })]));
		});

		test("returns only bounded safe data for the active organization", async () => {
			const otherSession = await createTestSession();
			const agentId = `source-${crypto.randomUUID()}`;
			const extraRoots = Array.from({ length: 100 }, (_, index) => ({
				id: `extra-${index}`,
				label: `Extra ${index}`,
				canBackup: true,
			}));
			const reportedRoots = [
				{
					id: "photos",
					label: "\u0000 Photos \u0007",
					canBackup: true,

					path: "/srv/photos",
				},
				{ id: "invalid/root", label: "Secret", canBackup: true },
				...extraRoots,
			];
			await db.insert(agentsTable).values([
				{
					id: agentId,
					organizationId: session.organizationId,
					name: "\u0000 NAS \u0007",
					kind: "remote",
					status: "online",
					lastSeenAt: 123,
					capabilities: {
						hostname: "secret.internal",
						configuredPath: "/srv/secret",
						trustedRoots: reportedRoots,
					},
				},
				{
					id: `other-${crypto.randomUUID()}`,
					organizationId: otherSession.organizationId,
					name: "Other organization",
					kind: "remote",
					status: "online",
					capabilities: { trustedRoots: [] },
				},
			]);

			const res = await app.request("/api/v1/volumes/source-machines", { headers: session.headers });
			expect(res.status).toBe(200);
			const body = await res.json();
			const discovered = body.find((machine: { id: string }) => machine.id === agentId);
			expect(discovered).toMatchObject({
				id: agentId,
				name: "Unnamed machine",
				status: "online",
				lastSeenAt: 123,
				revokedAt: null,
			});
			expect(discovered.trustedRoots).toEqual([]);
			expect(JSON.stringify(body)).not.toContain("secret.internal");
			expect(JSON.stringify(body)).not.toContain("/srv/");
			expect(JSON.stringify(body)).not.toContain("Other organization");
		});

		test.each([
			["POSIX", "/srv/private"],
			["tilde", "~/home"],
			["bare tilde", "~"],
			["user tilde", "~backup"],
			["current directory", "."],
			["parent directory", ".."],
			["drive", "C:\\Users\\private"],
			["UNC", "\\\\server\\private"],
			["backslash", "private\\photos"],
			["control", "private\u0000photos"],
		] as const)("does not expose %s path-like discovery labels", async (_kind, unsafeLabel) => {
			const agentId = `source-${crypto.randomUUID()}`;
			await db.insert(agentsTable).values({
				id: agentId,
				organizationId: session.organizationId,
				name: unsafeLabel,
				kind: "remote",
				status: "online",
				capabilities: {
					trustedRoots: [{ id: "private", label: unsafeLabel, canBackup: true }],
				},
			});

			const res = await app.request("/api/v1/volumes/source-machines", { headers: session.headers });
			expect(res.status).toBe(200);
			const body = await res.json();
			const discovered = body.find((machine: { id: string }) => machine.id === agentId);
			expect(discovered).toMatchObject({
				name: "Unnamed machine",
				trustedRoots: [{ id: "private", label: "Allowed location" }],
			});
			expect(JSON.stringify(discovered)).not.toContain(unsafeLabel);
		});

		test("preserves normal semantic discovery labels", async () => {
			const agentId = `source-${crypto.randomUUID()}`;
			await db.insert(agentsTable).values({
				id: agentId,
				organizationId: session.organizationId,
				name: "Family NAS",
				kind: "remote",
				status: "online",
				capabilities: {
					trustedRoots: [{ id: "photos", label: "Family photos", canBackup: true }],
				},
			});

			const res = await app.request("/api/v1/volumes/source-machines", { headers: session.headers });
			const body = await res.json();
			const discovered = body.find((machine: { id: string }) => machine.id === agentId);
			expect(discovered).toMatchObject({
				name: "Family NAS",
				trustedRoots: [{ id: "photos", label: "Family photos" }],
			});
		});
	});

	describe("information disclosure", () => {
		test("should not disclose if a volume exists when unauthenticated", async () => {
			const res = await app.request("/api/v1/volumes/non-existent-volume");
			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.message).toBe("Invalid or expired session");
		});
	});

	describe("input validation", () => {
		test("presents built-in local filesystem sources across create, get, list, and update", async () => {
			await agentsService.ensureLocalAgent();
			const implicitRoot = {
				id: BUILTIN_COMPATIBILITY_ROOT_ID,
				label: "Local filesystem",
				canBackup: true,
			};
			await db
				.update(agentsTable)
				.set({ status: "online", capabilities: { trustedRoots: [implicitRoot] } })
				.where(eq(agentsTable.id, LOCAL_AGENT_ID));
			const readinessSpy = vi.spyOn(agentManager, "isAgentReady").mockResolvedValue(true);
			const commandSpy = vi.spyOn(agentManager, "runVolumeCommand").mockResolvedValue({
				name: "volume.statfs",
				result: { total: 100, used: 10, free: 90 },
			});
			const name = `Local source-${crypto.randomUUID()}`;
			const headers = { ...session.headers, "Content-Type": "application/json" };

			try {
				const createResponse = await app.request("/api/v1/volumes", {
					method: "POST",
					headers,
					body: JSON.stringify({
						name,
						sourceKind: "agent-filesystem",
						agentId: LOCAL_AGENT_ID,
						trustedRootId: BUILTIN_COMPATIBILITY_ROOT_ID,
						relativePath: "tmp",
					}),
				});
				expect(createResponse.status).toBe(201);
				const created = await createResponse.json();
				expect(created.path).toBe("/tmp");
				expect(presentedVolumeDetailSchema.safeParse(created).success).toBe(true);
				expect(created.sourceLocation).toMatchObject({
					machine: { id: LOCAL_AGENT_ID, name: LOCAL_AGENT_NAME, status: "online" },
					root: implicitRoot,
					relativePath: "tmp",
					availability: "available",
				});

				const getResponse = await app.request(`/api/v1/volumes/${created.shortId}`, {
					headers: session.headers,
				});
				expect(getResponse.status).toBe(200);
				const detail = await getResponse.json();
				expect(detail.volume.path).toBe("/tmp");
				expect(presentedVolumeDetailSchema.safeParse(detail.volume).success).toBe(true);
				expect(detail.volume.sourceLocation).toMatchObject({
					machine: { id: LOCAL_AGENT_ID, name: LOCAL_AGENT_NAME },
					root: implicitRoot,
					availability: "available",
				});

				const listResponse = await app.request("/api/v1/volumes", { headers: session.headers });
				expect(listResponse.status).toBe(200);
				const listed = await listResponse.json();
				const listedCreated = listed.find((volume: { shortId: string }) => volume.shortId === created.shortId);
				expect(listedCreated).toBeDefined();
				expect(listedCreated).not.toHaveProperty("path");
				expect(presentedVolumeSchema.safeParse(listedCreated).success).toBe(true);
				expect(listed).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							shortId: created.shortId,
							sourceLocation: expect.objectContaining({ availability: "available", root: implicitRoot }),
						}),
					]),
				);

				const updateResponse = await app.request(`/api/v1/volumes/${created.shortId}`, {
					method: "PUT",
					headers,
					body: JSON.stringify({ name: `${name} updated` }),
				});
				expect(updateResponse.status).toBe(200);
				const updated = await updateResponse.json();
				expect(updated.path).toBe("/tmp");
				expect(presentedVolumeDetailSchema.safeParse(updated).success).toBe(true);
				expect(updated.sourceLocation).toMatchObject({
					machine: { id: LOCAL_AGENT_ID, name: LOCAL_AGENT_NAME },
					root: implicitRoot,
					availability: "available",
				});

				const explicitRoot = { id: "data", label: "Data", canBackup: true };
				await db
					.update(agentsTable)
					.set({ capabilities: { trustedRoots: [explicitRoot] } })
					.where(eq(agentsTable.id, LOCAL_AGENT_ID));
				const unavailableResponse = await app.request(`/api/v1/volumes/${created.shortId}`, {
					headers: session.headers,
				});
				expect(unavailableResponse.status).toBe(200);
				const unavailable = await unavailableResponse.json();
				expect(unavailable.volume.sourceLocation).toMatchObject({
					machine: { id: LOCAL_AGENT_ID, name: LOCAL_AGENT_NAME },
					root: { id: BUILTIN_COMPATIBILITY_ROOT_ID, label: "Allowed location" },
					availability: "root-removed",
				});
			} finally {
				readinessSpy.mockRestore();
				commandSpy.mockRestore();
			}
		});

		test("should return 404 for non-existent volume", async () => {
			const res = await app.request("/api/v1/volumes/non-existent-volume", {
				headers: session.headers,
			});

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.message).toBe("Volume not found");
		});

		test("should return 400 for invalid payload on create", async () => {
			const res = await app.request("/api/v1/volumes", {
				method: "POST",
				headers: {
					...session.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					name: "Test",
				}),
			});

			expect(res.status).toBe(400);
		});

		test("should mark provisioned volumes as managed", async () => {
			const volume = await createManagedVolumeRecord(session.organizationId);

			const res = await app.request(`/api/v1/volumes/${volume.shortId}`, { headers: session.headers });

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.volume.provisioningId).toBeDefined();
			expect(body.volume.sourceLocation).toBeNull();
			expect(presentedVolumeSchema.safeParse(body.volume).success).toBe(true);
		});

		test("returns schema-valid passive location fallbacks for agent filesystem details", async () => {
			const offlineVolume = await createAgentFilesystemVolumeRecord(session.organizationId, "mounted");
			await db.insert(agentsTable).values({
				id: offlineVolume.agentId,
				organizationId: session.organizationId,
				name: "Offline NAS",
				kind: "remote",
				status: "offline",
				capabilities: {
					trustedRoots: [{ id: "photos", label: "Photos", canBackup: true }],
				},
			});
			const missingVolume = await createAgentFilesystemVolumeRecord(session.organizationId, "mounted");
			const readinessSpy = vi.spyOn(agentManager, "isAgentReady");
			const commandSpy = vi.spyOn(agentManager, "runVolumeCommand");
			readinessSpy.mockClear();
			commandSpy.mockClear();

			try {
				const offlineResponse = await app.request(`/api/v1/volumes/${offlineVolume.shortId}`, {
					headers: session.headers,
				});
				expect(offlineResponse.status).toBe(200);
				const offlineBody = await offlineResponse.json();
				expect(offlineBody.volume.sourceLocation).toMatchObject({
					machine: { id: offlineVolume.agentId, name: "Offline NAS", status: "offline" },
					root: { id: "photos", label: "Photos" },
					relativePath: "family",
					availability: "offline",
				});
				expect(presentedVolumeSchema.safeParse(offlineBody.volume).success).toBe(true);

				const missingResponse = await app.request(`/api/v1/volumes/${missingVolume.shortId}`, {
					headers: session.headers,
				});
				expect(missingResponse.status).toBe(200);
				const missingBody = await missingResponse.json();
				expect(missingBody.volume.sourceLocation).toMatchObject({
					machine: { id: missingVolume.agentId, name: "Unavailable machine", status: "offline" },
					root: { id: "photos", label: "Allowed location" },
					relativePath: "family",
					availability: "missing-agent",
				});
				expect(presentedVolumeSchema.safeParse(missingBody.volume).success).toBe(true);
				expect(readinessSpy).not.toHaveBeenCalled();
				expect(commandSpy).not.toHaveBeenCalled();
			} finally {
				readinessSpy.mockRestore();
				commandSpy.mockRestore();
			}
		});

		test("should allow updates for managed volumes", async () => {
			const volume = await createManagedVolumeRecord(session.organizationId);

			const res = await app.request(`/api/v1/volumes/${volume.shortId}`, {
				method: "PUT",
				headers: {
					...session.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					sourceKind: "managed",
					name: "Updated volume",
				}),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.name).toBe("Updated volume");
			expect(body.sourceLocation).toBeNull();
		});

		test("resets stale source health when a changed location passes preflight", async () => {
			const volume = await createOnlineAgentFilesystemVolumeRecord(session.organizationId);
			const staleHealthCheck = 1_000;
			await db
				.update(volumesTable)
				.set({ lastError: "old location missing", lastHealthCheck: staleHealthCheck })
				.where(eq(volumesTable.id, volume.id));
			const readinessSpy = vi.spyOn(agentManager, "isAgentReady").mockResolvedValue(true);
			const commandSpy = vi.spyOn(agentManager, "runVolumeCommand").mockResolvedValue({
				name: "volume.statfs",
				result: { total: 100, used: 10, free: 90 },
			});
			const beforeUpdate = Date.now();
			const headers = { ...session.headers, "Content-Type": "application/json" };

			try {
				const response = await app.request(`/api/v1/volumes/${volume.shortId}`, {
					method: "PUT",
					headers,
					body: JSON.stringify({ relativePath: "archive" }),
				});
				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body).toMatchObject({
					relativePath: "archive",
					status: "mounted",
					lastError: null,
				});
				const persisted = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
				expect(persisted?.lastHealthCheck).toBeGreaterThanOrEqual(beforeUpdate);
			} finally {
				readinessSpy.mockRestore();
				commandSpy.mockRestore();
			}
		});

		test("preserves stale source health for a name-only edit", async () => {
			const volume = await createAgentFilesystemVolumeRecord(session.organizationId, "error");
			const staleHealthCheck = 1_000;
			await db
				.update(volumesTable)
				.set({ lastError: "source offline", lastHealthCheck: staleHealthCheck })
				.where(eq(volumesTable.id, volume.id));
			const commandSpy = vi.spyOn(agentManager, "runVolumeCommand");
			const headers = { ...session.headers, "Content-Type": "application/json" };

			try {
				const response = await app.request(`/api/v1/volumes/${volume.shortId}`, {
					method: "PUT",
					headers,
					body: JSON.stringify({ name: "Renamed source" }),
				});
				expect(response.status).toBe(200);
				const persisted = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
				expect(persisted).toMatchObject({
					name: "Renamed source",
					status: "error",
					lastError: "source offline",
					lastHealthCheck: staleHealthCheck,
				});
				expect(commandSpy).not.toHaveBeenCalled();
			} finally {
				commandSpy.mockRestore();
			}
		});

		test("leaves a source row unchanged when changed-location preflight fails", async () => {
			const volume = await createOnlineAgentFilesystemVolumeRecord(session.organizationId);
			const staleHealthCheck = 1_000;
			await db
				.update(volumesTable)
				.set({ lastError: "old location missing", lastHealthCheck: staleHealthCheck })
				.where(eq(volumesTable.id, volume.id));
			const beforeUpdate = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
			const readinessSpy = vi.spyOn(agentManager, "isAgentReady").mockResolvedValue(true);
			const commandSpy = vi.spyOn(agentManager, "runVolumeCommand").mockRejectedValue(new Error("path missing"));
			const headers = { ...session.headers, "Content-Type": "application/json" };

			try {
				const response = await app.request(`/api/v1/volumes/${volume.shortId}`, {
					method: "PUT",
					headers,
					body: JSON.stringify({ name: "Should not persist", relativePath: "missing" }),
				});
				expect(response.status).toBe(503);
				const afterUpdate = await db.query.volumesTable.findFirst({ where: { id: volume.id } });
				expect(afterUpdate).toEqual(beforeUpdate);
			} finally {
				readinessSpy.mockRestore();
				commandSpy.mockRestore();
			}
		});

		test.each([
			["agentId", { agentId: "local" }],
			["trustedRootId", { trustedRootId: "photos" }],
			["relativePath", { relativePath: "family" }],
		])("rejects the inapplicable managed-volume %s field", async (_field, patch) => {
			const volume = await createManagedVolumeRecord(session.organizationId);
			const res = await app.request(`/api/v1/volumes/${volume.shortId}`, {
				method: "PUT",
				headers: { ...session.headers, "Content-Type": "application/json" },
				body: JSON.stringify(patch),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.message).toContain("cannot have trusted filesystem locations");
		});

		test.each([
			["config", { config: { backend: "directory", path: "/tmp" } }],
			["autoRemount", { autoRemount: true }],
		])("rejects the inapplicable agent-filesystem %s field", async (_field, patch) => {
			const volume = await createAgentFilesystemVolumeRecord(session.organizationId);
			const res = await app.request(`/api/v1/volumes/${volume.shortId}`, {
				method: "PUT",
				headers: { ...session.headers, "Content-Type": "application/json" },
				body: JSON.stringify(patch),
			});

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.message).toContain("cannot have managed backend fields");
		});

		test("should allow deletion for managed volumes", async () => {
			const volume = await createManagedVolumeRecord(session.organizationId);
			vi.spyOn(agentManager, "runVolumeCommand").mockResolvedValue({
				name: "volume.unmount",
				result: { status: "unmounted" },
			});

			const res = await app.request(`/api/v1/volumes/${volume.shortId}`, {
				method: "DELETE",
				headers: session.headers,
			});

			expect(res.status).toBe(200);
		});
	});
});
