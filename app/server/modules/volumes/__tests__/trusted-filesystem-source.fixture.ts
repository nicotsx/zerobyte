import { randomUUID } from "node:crypto";
import { db } from "~/server/db/db";
import { agentsTable } from "~/server/db/schema";
import { createTestVolume } from "~/test/helpers/volume";

export const createTrustedFilesystemSource = async (
	organizationId: string,
	status: "online" | "offline" = "online",
) => {
	const agentId = `agent-${randomUUID()}`;
	await db.insert(agentsTable).values({
		id: agentId,
		organizationId,
		name: "NAS agent",
		kind: "remote",
		status,
		capabilities: {
			trustedRoots: [{ id: "photos", label: "Photos", canBackup: true }],
		},
	});
	const volume = await createTestVolume({
		organizationId,
		agentId,
		sourceKind: "agent-filesystem",
		trustedRootId: "photos",
		relativePath: "family",
		type: null,
		config: null,
		autoRemount: false,
		status: "mounted",
	});
	return { agentId, volume };
};
