import { BadRequestError, InternalServerError } from "http-errors-enhanced";
import {
	trustedRootDescriptorSchema,
	volumeSchema,
	type Volume as CanonicalVolume,
	type VolumeExecutionSource,
} from "@zerobyte/contracts/volumes";
import { db } from "../../db/db";
import type { Volume } from "../../db/schema";
import { LOCAL_AGENT_ID } from "../agents/constants";
import { decryptVolumeConfig } from "./volume-config-secrets";
import { getActionableTrustedRoot } from "./source-discovery";

export const validateTrustedRoot = async (agentId: string, rootId: string, organizationId: string) => {
	if (agentId !== LOCAL_AGENT_ID) {
		return getActionableTrustedRoot(agentId, rootId, organizationId);
	}

	const agent = await db.query.agentsTable.findFirst({ where: { id: agentId } });

	if (!agent) {
		throw new BadRequestError(`Agent "${agentId}" does not exist`);
	}

	const parsedRoots = trustedRootDescriptorSchema.array().safeParse(agent.capabilities.trustedRoots);

	if (!parsedRoots.success) {
		const statusDescription =
			agent.status === "offline" ? "offline and has no compatible last-known roots" : "incompatible";
		throw new BadRequestError(`Agent "${agent.name}" is ${statusDescription}`);
	}

	const root = parsedRoots.data.find((candidate) => candidate.id === rootId);

	if (!root) {
		throw new BadRequestError(`Trusted root "${rootId}" is not advertised by agent "${agent.name}"`);
	}
	if (!root.canBackup) {
		throw new BadRequestError(`Trusted root "${root.label}" does not allow backups`);
	}

	return root;
};

export const assembleTrustedFilesystemExecutionSource = async (
	agentId: string,
	rootId: string,
	relativePath: string,
	organizationId: string,
): Promise<VolumeExecutionSource> => {
	await validateTrustedRoot(agentId, rootId, organizationId);
	return { kind: "agent-filesystem", reference: { rootId, relativePath } };
};

export const toCanonicalVolume = (volume: Volume): CanonicalVolume => {
	if (volume.sourceKind === "agent-filesystem") {
		if (volume.trustedRootId === null || volume.relativePath === null) {
			throw new InternalServerError("Trusted filesystem source is incomplete");
		}

		return volumeSchema.parse({
			...volume,
			sourceKind: "agent-filesystem",
			config: null,
			type: null,
			trustedRootId: volume.trustedRootId,
			relativePath: volume.relativePath,
		});
	}

	if (volume.config === null || volume.type === null) {
		throw new InternalServerError("Managed volume configuration is incomplete");
	}

	return volumeSchema.parse({
		...volume,
		sourceKind: "managed",
		config: volume.config,
		type: volume.type,
		trustedRootId: null,
		relativePath: null,
	});
};

export const assembleVolumeExecutionSource = async (
	volume: Volume,
	organizationId: string,
): Promise<VolumeExecutionSource> => {
	const canonicalVolume = toCanonicalVolume(volume);

	if (canonicalVolume.sourceKind === "agent-filesystem") {
		return assembleTrustedFilesystemExecutionSource(
			canonicalVolume.agentId,
			canonicalVolume.trustedRootId,
			canonicalVolume.relativePath,
			organizationId,
		);
	}

	if (canonicalVolume.agentId !== LOCAL_AGENT_ID) {
		throw new BadRequestError("Managed volume backends can only run on the built-in local agent");
	}

	const decryptedConfig = await decryptVolumeConfig(canonicalVolume.config);
	const executionVolume = { ...canonicalVolume, config: decryptedConfig };

	return { kind: "managed", volume: executionVolume };
};
