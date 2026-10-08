import type { PublicVolume } from "@zerobyte/contracts/volumes";
import { isRemoteSource } from "@zerobyte/contracts/backup-context";
import { getSafeMachinePresentationLabel } from "~/lib/safe-presentation-label";
import { getOrganizationId } from "~/server/core/request-context";
import { db } from "~/server/db/db";
import type { Agent, VolumeRow } from "~/server/db/schema";
import { readVolume } from "~/server/db/volume";
import { presentAgentCapabilities } from "../agents/agent-capability-presentation";

export const presentVolumes = async (rows: readonly VolumeRow[]): Promise<PublicVolume[]> => {
	const volumes = rows.map(readVolume);
	const agentIds = volumes.filter((volume) => volume.sourceKind === "filesystem").map((volume) => volume.agentId);

	let agents: Pick<Agent, "id" | "name" | "capabilities">[] = [];

	if (agentIds.length > 0) {
		agents = await db.query.agentsTable.findMany({
			where: {
				id: { in: agentIds },
				OR: [
					{ kind: "local", organizationId: { isNull: true } },
					{ kind: "remote", organizationId: getOrganizationId() },
				],
			},
			columns: { id: true, name: true, capabilities: true },
		});
	}

	const machines = new Map(
		agents.map((agent) => [
			agent.id,
			{
				name: getSafeMachinePresentationLabel(agent.name).slice(0, 100),
				roots: presentAgentCapabilities(agent.capabilities).trustedRoots,
			},
		]),
	);

	return volumes.map((volume): PublicVolume => {
		const { organizationId: _organizationId, ...publicVolume } = volume;
		if (publicVolume.sourceKind === "managed") return { ...publicVolume, sourceLocation: null };

		const agent = machines.get(volume.agentId);
		const location =
			agent?.roots.find((root) => root.id === publicVolume.trustedRootId)?.label ?? publicVolume.trustedRootId;
		const machine = isRemoteSource(volume) ? (agent?.name ?? "Unknown machine") : "This server";

		let sourcePath = location;
		if (publicVolume.relativePath) sourcePath += `/${publicVolume.relativePath}`;

		return {
			...publicVolume,
			sourceLocation: {
				machine,
				location,
				path: sourcePath,
			},
		};
	});
};

export const presentVolume = async (volume: VolumeRow) => (await presentVolumes([volume]))[0];
