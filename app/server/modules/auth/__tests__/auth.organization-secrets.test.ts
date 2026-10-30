import { describe, expect, test } from "vitest";
import { createApp } from "~/server/app";
import { db } from "~/server/db/db";
import { createTestSession } from "~/test/helpers/auth";

const app = createApp();

describe("organization secret presentation", () => {
	test("keeps recovery material out of organization endpoints", async () => {
		const session = await createTestSession();
		const secrets = await db.query.organizationSecretsTable.findFirst({
			where: { organizationId: session.organizationId },
		});
		expect(secrets?.resticPassword).toBeTruthy();

		const [listResponse, detailResponse] = await Promise.all([
			app.request("/api/auth/organization/list", { headers: session.headers }),
			app.request(`/api/auth/organization/get-full-organization?organizationId=${session.organizationId}`, {
				headers: session.headers,
			}),
		]);

		expect(listResponse.status).toBe(200);
		expect(detailResponse.status).toBe(200);

		const presented = JSON.stringify([await listResponse.json(), await detailResponse.json()]);
		expect(presented).not.toContain("resticPassword");
		expect(presented).not.toContain(secrets!.resticPassword);
	});
});
