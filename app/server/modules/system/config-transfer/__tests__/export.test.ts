import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "~/server/db/db";
import { organization, repositoriesTable } from "~/server/db/schema";
import { createTestSession } from "~/test/helpers/auth";
import { cryptoUtils } from "~/server/utils/crypto";
import { generateShortId } from "~/server/utils/id";
import { decryptConfigTransferPayload } from "../envelope";
import { createPassphraseProtectedOrganizationConfigExport } from "../export";

const exportPassphrase = "legacy-empty-repository-export";

beforeEach(() => {
	vi.spyOn(cryptoUtils, "resolveSecret").mockImplementation(async (value) => value);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("createPassphraseProtectedOrganizationConfigExport", () => {
	test("exports legacy empty repository names with a stable fallback", async () => {
		const session = await createTestSession();
		const repositoryShortId = generateShortId();
		await db
			.update(organization)
			.set({ metadata: { resticPassword: "legacy-restic-password" } })
			.where(eq(organization.id, session.organizationId));
		await db.insert(repositoriesTable).values({
			id: crypto.randomUUID(),
			shortId: repositoryShortId,
			name: "",
			type: "local",
			config: { backend: "local", path: "/tmp/legacy-empty-name" },
			organizationId: session.organizationId,
		});

		const encryptedConfig = await createPassphraseProtectedOrganizationConfigExport(
			session.organizationId,
			exportPassphrase,
		);
		const exportedPayload = JSON.parse(await decryptConfigTransferPayload(encryptedConfig, exportPassphrase));
		const exportedRepository = exportedPayload.repositories[0];

		expect(exportedRepository.name).toBe(`Repository ${repositoryShortId}`);
		expect(exportedRepository.name).not.toBe("");
	});
});
