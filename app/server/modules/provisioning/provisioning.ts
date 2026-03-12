import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
	COMPRESSION_MODES,
	REPOSITORY_BACKENDS,
	repositoryConfigSchema,
	type RepositoryConfig,
} from "@zerobyte/core/restic";
import { logger } from "@zerobyte/core/node";
import { z } from "zod";
import { config as appConfig } from "~/server/core/config";
import { restic } from "~/server/core/restic";
import { db } from "~/server/db/db";
import { repositoriesTable, volumesTable } from "~/server/db/schema";
import { mapRepositoryConfigSecrets } from "~/server/modules/repositories/repository-config-secrets";
import { mapVolumeConfigSecrets } from "~/server/modules/volumes/volume-config-secrets";
import { BACKEND_TYPES, volumeConfigSchema, type BackendConfig } from "~/schemas/volumes";
import { cryptoUtils } from "~/server/utils/crypto";
import { toMessage } from "~/server/utils/errors";
import { generateShortId } from "~/server/utils/id";

const envSecretPrefix = "env://";
const fileSecretPrefix = "file://";

const provisionedRepositorySchema = z.object({
	id: z.string().min(1),
	organizationId: z.string().min(1),
	name: z.string().min(1),
	compressionMode: z.enum(COMPRESSION_MODES).optional(),
	config: repositoryConfigSchema,
	backend: z.enum(REPOSITORY_BACKENDS),
	delete: z.boolean().default(false),
});
type ProvisionedRepository = z.infer<typeof provisionedRepositorySchema>;

const provisionedVolumeSchema = z.object({
	id: z.string().min(1),
	organizationId: z.string().min(1),
	name: z.string().min(1),
	autoRemount: z.boolean().default(true),
	config: volumeConfigSchema,
	delete: z.boolean().default(false),
	backend: z.enum(BACKEND_TYPES),
});
type ProvisionedVolume = z.infer<typeof provisionedVolumeSchema>;

export const provisionedResourcesSchema = z
	.object({
		version: z.literal(1).default(1),
		repositories: z.array(provisionedRepositorySchema).default([]),
		volumes: z.array(provisionedVolumeSchema).default([]),
	})
	.superRefine((value, ctx) => {
		const repositoryIds = new Set<string>();
		for (const repository of value.repositories) {
			const key = `${repository.organizationId}:${repository.id}`;
			if (repositoryIds.has(key)) {
				ctx.addIssue({
					code: "custom",
					message: `Duplicate provisioned repository id for organization ${repository.organizationId}: ${repository.id}`,
					path: ["repositories"],
				});
			}
			repositoryIds.add(key);
		}

		const volumeIds = new Set<string>();
		for (const volume of value.volumes) {
			const key = `${volume.organizationId}:${volume.id}`;
			if (volumeIds.has(key)) {
				ctx.addIssue({
					code: "custom",
					message: `Duplicate provisioned volume id for organization ${volume.organizationId}: ${volume.id}`,
					path: ["volumes"],
				});
			}
			volumeIds.add(key);
		}
	});

type ProvisionedResources = z.infer<typeof provisionedResourcesSchema>;

export const readProvisionedResourcesFile = async (filePath: string): Promise<ProvisionedResources> => {
	const content = await fs.readFile(filePath, "utf-8");
	const parsed = JSON.parse(content) as unknown;

	return provisionedResourcesSchema.parse(parsed);
};

const resolveProvisioningSecret = async (value: string): Promise<string> => {
	if (!value) {
		return value;
	}

	if (value.startsWith(envSecretPrefix)) {
		const name = value.slice(envSecretPrefix.length);
		if (!name) {
			throw new Error("Provisioned env secret reference is missing a variable name");
		}

		const resolved = process.env[name];
		if (resolved === undefined) {
			throw new Error(`Environment variable not set: ${name}`);
		}

		return resolved;
	}

	if (value.startsWith(fileSecretPrefix)) {
		const secretName = value.slice(fileSecretPrefix.length).replace(/^\/+/, "");
		if (!secretName) {
			throw new Error("Provisioned file secret reference is missing a secret name");
		}
		if (secretName.includes("/") || secretName.includes("\\") || secretName.includes("\0")) {
			throw new Error("Provisioned file secret reference must be a single path segment");
		}

		const secretPath = path.join("/run/secrets", secretName);
		const content = await fs.readFile(secretPath, "utf-8").catch(() => {
			throw new Error(`Provisioned secret file not found: ${secretPath}`);
		});
		return content.trimEnd();
	}

	return value;
};

const sealProvisionedSecret = async (value: string): Promise<string> => {
	const resolved = await resolveProvisioningSecret(value);
	return cryptoUtils.sealSecret(resolved);
};

const encryptProvisionedRepositoryConfig = async (config: RepositoryConfig): Promise<RepositoryConfig> => {
	return await mapRepositoryConfigSecrets(config, sealProvisionedSecret);
};

const encryptProvisionedVolumeConfig = async (config: BackendConfig): Promise<BackendConfig> => {
	return await mapVolumeConfigSecrets(config, sealProvisionedSecret);
};

const syncProvisionedRepositories = async (repositories: ProvisionedRepository[]) => {
	const existingRepositories = await db.query.repositoriesTable.findMany({
		where: { AND: [{ provisioningId: { isNotNull: true } }] },
	});

	for (const repository of repositories) {
		const provisioningId = `provisioned:${repository.organizationId}:${repository.id}`;

		if (repository.delete) {
			await db.delete(repositoriesTable).where(eq(repositoriesTable.provisioningId, provisioningId));
			continue;
		}

		const existing = existingRepositories.find((r) => r.provisioningId === provisioningId);
		const encryptedConfig = await encryptProvisionedRepositoryConfig(repository.config);

		if (!existing) {
			const id = Bun.randomUUIDv7();

			await db.insert(repositoriesTable).values({
				id,
				provisioningId: provisioningId,
				shortId: generateShortId(),
				name: repository.name,
				type: repository.backend,
				config: encryptedConfig,
				compressionMode: repository.compressionMode,
				status: "unknown",
				organizationId: repository.organizationId,
			});

			if (!repository.config.isExistingRepository) {
				const result = await restic
					.init(encryptedConfig, repository.organizationId, { timeoutMs: appConfig.serverIdleTimeout * 1000 })
					.catch((error) => ({ success: false, error }));

				await db
					.update(repositoriesTable)
					.set({
						status: result.error ? "error" : "healthy",
						lastChecked: Date.now(),
						lastError: result.error ? toMessage(result.error) : null,
						updatedAt: Date.now(),
					})
					.where(eq(repositoriesTable.id, id));

				if (result.error) {
					logger.error(`Provisioned repository ${repository.name} failed to initialize: ${toMessage(result.error)}`);
				}
			}
			continue;
		}

		const updatePayload = {
			name: repository.name,
			type: repository.backend,
			config: encryptedConfig,
			compressionMode: repository.compressionMode,
			organizationId: repository.organizationId,
			updatedAt: Date.now(),
		};

		await db.update(repositoriesTable).set(updatePayload).where(eq(repositoriesTable.id, existing.id));
	}
};

const syncProvisionedVolumes = async (volumes: ProvisionedVolume[]) => {
	const existingVolumes = await db.query.volumesTable.findMany({
		where: { AND: [{ provisioningId: { isNotNull: true } }] },
	});

	for (const volume of volumes) {
		const provisioningId = `provisioned:${volume.organizationId}:${volume.id}`;

		if (volume.delete) {
			await db.delete(volumesTable).where(eq(volumesTable.provisioningId, provisioningId));
			continue;
		}

		const existing = existingVolumes.find((v) => v.provisioningId === provisioningId);

		if (!existing) {
			await db.insert(volumesTable).values({
				shortId: generateShortId(),
				provisioningId: provisioningId,
				name: volume.name,
				type: volume.backend,
				config: await encryptProvisionedVolumeConfig(volume.config),
				autoRemount: volume.autoRemount,
				status: volume.autoRemount ? "mounted" : "unmounted",
				organizationId: volume.organizationId,
			});
			continue;
		}

		const updatePayload = {
			name: volume.name,
			type: volume.backend,
			config: await encryptProvisionedVolumeConfig(volume.config),
			autoRemount: volume.autoRemount,
			organizationId: volume.organizationId,
			updatedAt: Date.now(),
		};

		await db.update(volumesTable).set(updatePayload).where(eq(volumesTable.id, existing.id));
	}
};

export const syncProvisionedResources = async (filePath?: string) => {
	if (!filePath) {
		return;
	}

	const resources = await readProvisionedResourcesFile(filePath);
	await syncProvisionedRepositories(resources.repositories);
	await syncProvisionedVolumes(resources.volumes);

	logger.info(
		`Synchronized ${resources.repositories.length} provisioned repositor${resources.repositories.length === 1 ? "y" : "ies"} and ${resources.volumes.length} provisioned volume${resources.volumes.length === 1 ? "" : "s"}`,
	);
};
