import { test, describe, expect } from "bun:test";
import { volumeService } from "../volume.service";
import { db } from "~/server/db/db";
import { volumesTable } from "~/server/db/schema";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTestSession } from "~/test/helpers/auth";
import { withContext } from "~/server/core/request-context";
import { asShortId } from "~/server/utils/branded";

describe("volumeService", () => {
	describe("findVolume", () => {
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
				expect(volumeService.getVolume(asShortId("nonexistent"))).rejects.toThrow("Volume not found");
			});
		});
	});
});

describe("volumeService security", () => {
	describe("path traversal", () => {
		test("should reject traversal outside the volume root in listFiles", async () => {
			const { organizationId, user } = await createTestSession();
			const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-vol-svc-"));
			const volumePath = path.join(tempRoot, "vol");
			const secretPath = path.join(tempRoot, "volume-secret");

			await fs.mkdir(volumePath, { recursive: true });
			await fs.mkdir(secretPath, { recursive: true });
			await fs.writeFile(path.join(secretPath, "secret.txt"), "top secret", "utf-8");

			const [volume] = await db
				.insert(volumesTable)
				.values({
					shortId: asShortId(randomUUID().slice(0, 8)),
					name: `test-vol-${randomUUID().slice(0, 8)}`,
					type: "directory",
					status: "mounted",
					config: { backend: "directory", path: volumePath },
					autoRemount: true,
					organizationId,
				})
				.returning();

			try {
				await withContext({ organizationId, userId: user.id }, async () => {
					const traversalPath = `../${path.basename(secretPath)}`;

					expect(volumeService.listFiles(volume.shortId, traversalPath)).rejects.toThrow("Invalid path");
				});
			} finally {
				await fs.rm(tempRoot, { recursive: true, force: true });
			}
		});
	});
});
