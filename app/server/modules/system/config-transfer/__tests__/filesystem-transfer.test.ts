import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { agentsTable, backupSchedulesTable, volumesTable } from "~/server/db/schema";
import { cryptoUtils } from "~/server/utils/crypto";
import { generateShortId } from "~/server/utils/id";
import { syncProvisionedResources } from "~/server/modules/provisioning/provisioning";
import { createTestSession } from "~/test/helpers/auth";
import { createPassphraseProtectedOrganizationConfigExport } from "../export";
import { decryptConfigTransferPayload } from "../envelope";
import { importConfig } from "../import";
import { encodeCurrentConfigTransferPayload, parseConfigTransferPayload } from "../payload";
import { encryptPayload, fixturePassphrase } from "./config-transfer-test-helpers";
import { seedConfig } from "./config-transfer-fixture-test-helpers";

beforeEach(() => {
	config.webhookAllowedOrigins = ["https://example.com", "https://hooks.slack.example.test"];
	vi.spyOn(cryptoUtils, "sealSecret").mockImplementation(async (value) => `encv1:test:${value}`);
	vi.spyOn(cryptoUtils, "resolveSecret").mockImplementation(async (value) =>
		value.startsWith("encv1:test:") ? value.slice("encv1:test:".length) : value,
	);
});

afterEach(() => {
	config.webhookAllowedOrigins = [];
	vi.restoreAllMocks();
});

const loadV2Fixture = async () =>
	JSON.parse(
		await readFile(new URL("../../__fixtures__/config-transfer/v2-full.payload.json", import.meta.url), "utf8"),
	);

test("round-trips the permanent v2 recovery artifact", async () => {
	const fixture = await loadV2Fixture();

	expect(encodeCurrentConfigTransferPayload(parseConfigTransferPayload(fixture))).toEqual(fixture);
});

test("imports filesystem ownership and schedules with safe remote reconnection defaults", async () => {
	const session = await createTestSession();
	const fixture = await loadV2Fixture();
	const result = await importConfig(
		session.organizationId,
		session.user.id,
		await encryptPayload(fixture),
		fixturePassphrase,
	);
	const machines = await db.query.agentsTable.findMany({ where: { organizationId: session.organizationId } });
	const volumes = await db.query.volumesTable.findMany({ where: { organizationId: session.organizationId } });
	const schedules = await db.query.backupSchedulesTable.findMany({
		where: { organizationId: session.organizationId },
	});
	const remote = volumes.find((volume) => volume.name === "Remote documents");
	const local = volumes.find((volume) => volume.name === "Local photos");

	expect(machines).toHaveLength(1);
	expect(machines[0]).toMatchObject({
		name: "Remote workstation",
		kind: "remote",
		status: "offline",
		credentialHash: null,
		credentialVersion: 0,
		enrollmentExpiresAt: null,
		capabilities: {},
	});
	expect(machines[0]?.revokedAt).toEqual(expect.any(Number));
	expect(remote).toMatchObject({
		agentId: machines[0]?.id,
		sourceKind: "filesystem",
		config: null,
		type: null,
		trustedRootId: "documents",
		relativePath: "projects",
	});
	expect(local).toMatchObject({
		agentId: "local",
		sourceKind: "filesystem",
		trustedRootId: "photos",
		relativePath: "",
	});
	expect(schedules.find((schedule) => schedule.name === "Filesystem backup 0")).toMatchObject({
		volumeId: remote?.id,
		enabled: false,
	});
	expect(schedules.find((schedule) => schedule.name === "Filesystem backup 1")).toMatchObject({
		volumeId: local?.id,
		enabled: false,
	});
	expect(result.warnings.join("\n")).toContain("Rotate its enrollment token and reconnect");
});

test("exports mixed sources without remote credentials, capabilities or absolute root paths", async () => {
	const session = await createTestSession();
	const { schedule } = await seedConfig(session.organizationId);
	const remoteId = crypto.randomUUID();

	await db.insert(agentsTable).values({
		id: remoteId,
		organizationId: session.organizationId,
		name: "Workstation",
		kind: "remote",
		status: "online",
		credentialHash: "private-credential",
		capabilities: {
			trustedRoots: [{ id: "documents", label: "Documents", canBackup: true, path: "/private/remote/root" }],
		},
	});
	const [source] = await db
		.insert(volumesTable)
		.values({
			shortId: generateShortId(),
			name: "Remote source",
			organizationId: session.organizationId,
			sourceKind: "filesystem",
			agentId: remoteId,
			trustedRootId: "documents",
			relativePath: "work",
			config: null,
			type: null,
		})
		.returning();
	await db.update(backupSchedulesTable).set({ volumeId: source!.id }).where(eq(backupSchedulesTable.id, schedule.id));

	const encrypted = await createPassphraseProtectedOrganizationConfigExport(
		session.organizationId,
		fixturePassphrase,
	);
	const plaintext = await decryptConfigTransferPayload(encrypted, fixturePassphrase);
	const payload = parseConfigTransferPayload(JSON.parse(plaintext));
	const remote = payload.volumes.find((volume) => volume.name === "Remote source");

	expect(payload.volumes).toHaveLength(2);
	expect(payload.machines).toEqual([{ ref: "machine:1", name: "Workstation" }]);
	expect(payload.volumes.find((volume) => volume.name === "Parity Volume")?.machineRef).toBeNull();
	expect(remote).toMatchObject({
		sourceKind: "agent-filesystem",
		trustedRootId: "documents",
		relativePath: "work",
		machineRef: payload.machines[0]?.ref,
	});
	expect(payload.backupSchedules[0]?.volumeRef).toBe(remote?.ref);
	for (const secret of [remoteId, "private-credential", "/private/remote/root", "capabilities", "credentialHash"]) {
		expect(plaintext).not.toContain(secret);
	}
});

test("recovers provisioned sources with missing owners as shared portable offline machines", async () => {
	const session = await createTestSession();
	const otherSession = await createTestSession();
	const { schedule } = await seedConfig(session.organizationId);
	const unrelatedOwnerId = crypto.randomUUID();
	const sources = [
		{
			id: "documents",
			name: "Documents",
			agentId: "not-enrolled",
			trustedRootId: "documents",
			relativePath: "work",
		},
		{ id: "photos", name: "Photos", agentId: "not-enrolled", trustedRootId: "photos", relativePath: "family" },
		{ id: "archive", name: "Archive", agentId: unrelatedOwnerId, trustedRootId: "archive", relativePath: "" },
	].map((source) => ({ ...source, organizationId: session.organizationId, sourceKind: "filesystem" }));
	const tempDir = await mkdtemp(join(tmpdir(), "zerobyte-transfer-provisioning-"));
	const provisioningPath = join(tempDir, "provisioning.json");

	await db.insert(agentsTable).values({
		id: unrelatedOwnerId,
		organizationId: otherSession.organizationId,
		name: "Private unrelated machine",
		kind: "remote",
		credentialHash: "unrelated-credential",
		capabilities: { trustedRoots: [{ id: "archive", path: "/private/unrelated/root", canBackup: true }] },
	});

	try {
		await writeFile(provisioningPath, JSON.stringify({ volumes: sources }));
		await syncProvisionedResources(provisioningPath);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}

	const provisioned = await db.query.volumesTable.findMany({ where: { organizationId: session.organizationId } });
	const documents = provisioned.find((volume) => volume.name === "Documents");

	expect(documents).toMatchObject({ agentId: "not-enrolled", sourceKind: "filesystem" });
	expect(await db.query.agentsTable.findMany({ where: { organizationId: session.organizationId } })).toEqual([]);

	await db
		.update(backupSchedulesTable)
		.set({ volumeId: documents!.id })
		.where(eq(backupSchedulesTable.id, schedule.id));

	const encrypted = await createPassphraseProtectedOrganizationConfigExport(
		session.organizationId,
		fixturePassphrase,
	);
	const plaintext = await decryptConfigTransferPayload(encrypted, fixturePassphrase);
	const payload = parseConfigTransferPayload(JSON.parse(plaintext));
	const exportedDocuments = payload.volumes.find((volume) => volume.name === "Documents");
	const exportedPhotos = payload.volumes.find((volume) => volume.name === "Photos");
	const exportedArchive = payload.volumes.find((volume) => volume.name === "Archive");
	const documentsMachine = payload.machines.find((machine) => machine.ref === exportedDocuments?.machineRef);
	const archiveMachine = payload.machines.find((machine) => machine.ref === exportedArchive?.machineRef);

	expect(payload.machines).toEqual([
		{ ref: "machine:1", name: "Missing machine 1" },
		{ ref: "machine:2", name: "Missing machine 2" },
	]);
	expect(documentsMachine).toBeDefined();
	expect(archiveMachine).toBeDefined();
	expect(exportedPhotos?.machineRef).toBe(exportedDocuments?.machineRef);
	expect(exportedArchive?.machineRef).not.toBe(exportedDocuments?.machineRef);
	expect(payload.backupSchedules[0]?.volumeRef).toBe(exportedDocuments?.ref);
	for (const privateValue of [
		"not-enrolled",
		unrelatedOwnerId,
		"Private unrelated machine",
		"unrelated-credential",
		"/private/unrelated/root",
	]) {
		expect(plaintext).not.toContain(privateValue);
	}

	const recoverySession = await createTestSession();
	const result = await importConfig(
		recoverySession.organizationId,
		recoverySession.user.id,
		encrypted,
		fixturePassphrase,
	);
	const machines = await db.query.agentsTable.findMany({ where: { organizationId: recoverySession.organizationId } });
	const recoveredSources = await db.query.volumesTable.findMany({
		where: { organizationId: recoverySession.organizationId },
	});
	const recoveredDocuments = recoveredSources.find((volume) => volume.name === "Documents");
	const recoveredPhotos = recoveredSources.find((volume) => volume.name === "Photos");
	const recoveredArchive = recoveredSources.find((volume) => volume.name === "Archive");
	const recoveredSchedules = await db.query.backupSchedulesTable.findMany({
		where: { organizationId: recoverySession.organizationId },
	});

	expect(machines).toHaveLength(2);
	for (const machine of machines) {
		expect(machine).toMatchObject({
			kind: "remote",
			status: "offline",
			credentialHash: null,
			credentialVersion: 0,
			enrollmentExpiresAt: null,
			capabilities: {},
		});
		expect(machine.revokedAt).toEqual(expect.any(Number));
		expect(["not-enrolled", unrelatedOwnerId]).not.toContain(machine.id);
	}
	for (const source of sources) {
		expect(recoveredSources.find((volume) => volume.name === source.name)).toMatchObject({
			sourceKind: "filesystem",
			trustedRootId: source.trustedRootId,
			relativePath: source.relativePath,
			config: null,
			type: null,
		});
	}
	expect(recoveredDocuments?.agentId).toBe(machines.find((machine) => machine.name === documentsMachine?.name)?.id);
	expect(recoveredPhotos?.agentId).toBe(recoveredDocuments?.agentId);
	expect(recoveredArchive?.agentId).toBe(machines.find((machine) => machine.name === archiveMachine?.name)?.id);
	expect(recoveredSchedules[0]).toMatchObject({
		name: schedule.name,
		volumeId: recoveredDocuments?.id,
		enabled: false,
	});
	expect(result.warnings).toContain(
		'Machine "Missing machine 1" was imported offline without credentials. Rotate its enrollment token and reconnect it before using its sources.',
	);
	expect(result.warnings).toContain(
		'Source "Documents" requires review of trusted root "documents" on its machine before using it.',
	);
});

test.each(["/absolute", "../outside", "nested/../outside", "C:\\private", "C:/private", "bad\0path"])(
	"rejects nonportable filesystem path %s",
	async (relativePath) => {
		const fixture = await loadV2Fixture();
		fixture.volumes[1].relativePath = relativePath;

		expect(() => parseConfigTransferPayload(fixture)).toThrow();
	},
);

test("rejects dangling and duplicated machine references", async () => {
	const fixture = await loadV2Fixture();
	fixture.volumes[1].machineRef = "machine:missing";
	expect(() => parseConfigTransferPayload(fixture)).toThrow("Unknown machine reference");

	fixture.volumes[1].machineRef = "machine:1";
	fixture.machines.push({ ...fixture.machines[0] });
	expect(() => parseConfigTransferPayload(fixture)).toThrow("Duplicate machine reference");
});

test.each(["credentialHash", "capabilities", "id"])(
	"rejects machine identity field %s on the portable wire",
	async (field) => {
		const fixture = await loadV2Fixture();
		fixture.machines[0][field] = "private-machine-state";

		expect(() => parseConfigTransferPayload(fixture)).toThrow();
	},
);

test("rejects absolute paths masquerading as trusted root identifiers", async () => {
	const fixture = await loadV2Fixture();
	fixture.volumes[1].trustedRootId = "/private/remote/root";

	expect(() => parseConfigTransferPayload(fixture)).toThrow();
});
