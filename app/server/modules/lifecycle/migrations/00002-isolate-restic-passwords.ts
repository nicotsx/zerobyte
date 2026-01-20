import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../../db/db";
import { organization, repositoriesTable, volumesTable, notificationDestinationsTable } from "../../../db/schema";
import { logger } from "../../../utils/logger";
import { toMessage } from "~/server/utils/errors";
import { cryptoUtils } from "~/server/utils/crypto";
import type { RepositoryConfig } from "~/schemas/restic";
import type { BackendConfig } from "~/schemas/volumes";
import type { NotificationConfig } from "~/schemas/notifications";
import { RESTIC_PASS_FILE } from "~/server/core/constants";

/**
 * Migration: Isolate Restic Passwords
 *
 * This migration performs two critical tasks:
 * 1. Assigns unique restic passwords to each organization (using the legacy password for existing orgs)
 * 2. Re-keys all encrypted secrets from the legacy restic passfile to use the new APP_SECRET
 *
 * This allows per-organization encryption key isolation while ensuring
 * database encryption is decoupled from restic repository passwords.
 */

const legacyDecrypt = async (encryptedData: string): Promise<string> => {
	const keyLength = 32;
	const algorithm = "aes-256-gcm" as const;

	if (!cryptoUtils.isEncrypted(encryptedData)) {
		return encryptedData;
	}

	const secret = (await Bun.file(RESTIC_PASS_FILE).text()).trim();

	const parts = encryptedData.split(":").slice(1); // Remove prefix
	const saltHex = parts.shift() as string;
	const salt = Buffer.from(saltHex, "hex");

	const key = crypto.pbkdf2Sync(secret, salt, 100000, keyLength, "sha256");

	const iv = Buffer.from(parts.shift() as string, "hex");
	const encrypted = Buffer.from(parts.shift() as string, "hex");
	const tag = Buffer.from(parts.shift() as string, "hex");
	const decipher = crypto.createDecipheriv(algorithm, key, iv);

	decipher.setAuthTag(tag);

	let decrypted = decipher.update(encrypted);
	decrypted = Buffer.concat([decrypted, decipher.final()]);

	return decrypted.toString();
};

type MigrationError = { name: string; error: string };

const rekeySecrets = async (config: Record<string, unknown>): Promise<Record<string, unknown>> => {
	const rekeyedConfig: Record<string, unknown> = { ...config };

	for (const [key, value] of Object.entries(rekeyedConfig)) {
		if (typeof value === "string" && cryptoUtils.isEncrypted(value)) {
			const decrypted = await legacyDecrypt(value);
			rekeyedConfig[key] = await cryptoUtils.sealSecret(decrypted);
		} else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			rekeyedConfig[key] = await rekeySecrets(value as Record<string, unknown>);
		}
	}

	return rekeyedConfig;
};

const execute = async () => {
	const errors: MigrationError[] = [];

	// Step 1: Read the legacy restic passfile
	const legacyPassword = (await Bun.file(RESTIC_PASS_FILE).text()).trim();

	if (!legacyPassword) {
		logger.info("No legacy restic passfile found, skipping migration");
		return { success: true, errors: [] };
	}

	// Step 2: Assign restic passwords to all existing organizations
	const organizations = await db.query.organization.findMany({});

	for (const org of organizations) {
		try {
			const currentMetadata = org.metadata;

			if (!currentMetadata?.resticPassword) {
				const newMetadata = {
					...currentMetadata,
					resticPassword: await cryptoUtils.sealSecret(legacyPassword),
				};

				await db.update(organization).set({ metadata: newMetadata }).where(eq(organization.id, org.id));

				logger.info(`Assigned restic password to organization: ${org.name}`);
			}
		} catch (err) {
			errors.push({ name: `org:${org.name}`, error: toMessage(err) });
		}
	}

	// Step 3: Re-key all repository secrets
	const repositories = await db.query.repositoriesTable.findMany({});

	for (const repo of repositories) {
		try {
			const rekeyedConfig = (await rekeySecrets(repo.config)) as RepositoryConfig;

			await db.update(repositoriesTable).set({ config: rekeyedConfig }).where(eq(repositoriesTable.id, repo.id));

			logger.info(`Re-keyed secrets for repository: ${repo.name}`);
		} catch (err) {
			errors.push({ name: `repo:${repo.name}`, error: toMessage(err) });
		}
	}

	// Step 4: Re-key all volume secrets
	const volumes = await db.query.volumesTable.findMany({});

	for (const volume of volumes) {
		try {
			const rekeyedConfig = (await rekeySecrets(volume.config)) as BackendConfig;

			await db.update(volumesTable).set({ config: rekeyedConfig }).where(eq(volumesTable.id, volume.id));

			logger.info(`Re-keyed secrets for volume: ${volume.name}`);
		} catch (err) {
			errors.push({ name: `volume:${volume.name}`, error: toMessage(err) });
		}
	}

	// Step 5: Re-key all notification secrets
	const notifications = await db.query.notificationDestinationsTable.findMany({});

	for (const notification of notifications) {
		try {
			const rekeyedConfig = (await rekeySecrets(notification.config)) as NotificationConfig;

			await db
				.update(notificationDestinationsTable)
				.set({ config: rekeyedConfig })
				.where(eq(notificationDestinationsTable.id, notification.id));

			logger.info(`Re-keyed secrets for notification: ${notification.name}`);
		} catch (err) {
			errors.push({ name: `notification:${notification.name}`, error: toMessage(err) });
		}
	}

	return { success: errors.length === 0, errors };
};

export const v00002 = {
	execute,
	id: "00002-isolate-restic-passwords",
	type: "critical" as const,
	dependsOn: ["00001-retag-snapshots"],
};
