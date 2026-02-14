import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { Command } from "commander";
import { eq } from "drizzle-orm";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { db } from "../../db/db";
import { twoFactor } from "../../db/schema";
import { RESTIC_PASS_FILE } from "~/server/core/constants";
import { cryptoUtils } from "~/server/utils/crypto";
import { toMessage } from "~/server/utils/errors";

const hkdf = promisify(crypto.hkdf);

const deriveSecretFromBase = async (baseSecret: string, label: string): Promise<string> => {
	const derivedKey = await hkdf("sha256", baseSecret, "", label, 32);

	return Buffer.from(derivedKey).toString("hex");
};

const resolveLegacySecret = async (options: { legacySecret?: string; legacySecretFile?: string }) => {
	if (options.legacySecret && options.legacySecretFile) {
		throw new Error("Use either --legacy-secret or --legacy-secret-file, not both");
	}

	if (options.legacySecret) {
		return options.legacySecret.trim();
	}

	const legacyPath = options.legacySecretFile ?? RESTIC_PASS_FILE;

	try {
		const content = await readFile(legacyPath, "utf-8");
		const secret = content.trim();

		if (!secret) {
			throw new Error("Legacy secret file is empty");
		}

		return secret;
	} catch (error) {
		const message = toMessage(error);
		throw new Error(`Failed to read legacy secret from ${legacyPath}: ${message}`);
	}
};

const rekeyTwoFactor = async (legacySecret: string) => {
	const legacyAuthSecret = await deriveSecretFromBase(legacySecret, "better-auth");
	const currentAuthSecret = await cryptoUtils.deriveSecret("better-auth");
	const records = await db.query.twoFactor.findMany({});
	const errors: Array<{ userId: string; error: string }> = [];
	const updates: Array<{ id: string; userId: string; secret: string; backupCodes: string }> = [];

	for (const record of records) {
		try {
			const decryptedSecret = await symmetricDecrypt({ key: legacyAuthSecret, data: record.secret });
			const decryptedBackupCodes = await symmetricDecrypt({
				key: legacyAuthSecret,
				data: record.backupCodes,
			});

			updates.push({
				id: record.id,
				userId: record.userId,
				secret: await symmetricEncrypt({ key: currentAuthSecret, data: decryptedSecret }),
				backupCodes: await symmetricEncrypt({ key: currentAuthSecret, data: decryptedBackupCodes }),
			});
		} catch (error) {
			errors.push({ userId: record.userId, error: toMessage(error) });
		}
	}

	let updated = 0;

	db.transaction((tx) => {
		for (const record of updates) {
			try {
				tx
					.update(twoFactor)
					.set({
						secret: record.secret,
						backupCodes: record.backupCodes,
					})
					.where(eq(twoFactor.id, record.id))
					.run();

				updated += 1;
			} catch (error) {
				errors.push({ userId: record.userId, error: toMessage(error) });
			}
		}
	});

	return { total: records.length, updated, errors };
};

export const rekey2FACommand = new Command("rekey-2fa")
	.description("Re-encrypt 2FA secrets using the current APP_SECRET")
	.option("-s, --legacy-secret <secret>", "Legacy better-auth base secret (restic.pass content)")
	.option("-f, --legacy-secret-file <path>", "Path to legacy secret file (defaults to RESTIC_PASS_FILE)")
	.action(async (options) => {
		console.info("\n🔐 Zerobyte 2FA Re-key\n");

		try {
			const legacySecret = await resolveLegacySecret(options);
			const { total, updated, errors } = await rekeyTwoFactor(legacySecret);

			if (total === 0) {
				console.info("ℹ️  No two-factor records found. Nothing to re-key.");
				process.exit(0);
			}

			if (errors.length > 0) {
				console.error(`\n❌ Re-keyed ${updated}/${total} two-factor records.`);
				for (const error of errors) {
					console.error(`   - User ${error.userId}: ${error.error}`);
				}
				process.exit(1);
			}

			console.info(`\n✅ Re-keyed ${updated}/${total} two-factor records successfully.`);
			process.exit(0);
		} catch (error) {
			console.error(`\n❌ Failed to re-key 2FA secrets: ${toMessage(error)}`);
			process.exit(1);
		}
	});
