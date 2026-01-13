import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type } from "arktype";
import { RESTIC_PASS_FILE } from "../../core/constants";
import { logger } from "../logger";

export const parseResticJsonOutput = <T>(
	jsonString: string,
	schema: (data: unknown) => T | type.errors,
	context: string,
): T | null => {
	try {
		const parsed = JSON.parse(jsonString);
		const result = schema(parsed);

		if (result instanceof type.errors) {
			logger.warn(`${context} validation failed: ${result.summary}`);
			return null;
		}

		return result;
	} catch (error) {
		logger.warn(`${context} JSON parse failed:`, error);
		return null;
	}
};

export const createTempFile = async (prefix: string, content: string): Promise<string> => {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	const filePath = path.join(tmpDir, "content.txt");
	await fs.writeFile(filePath, content, "utf-8");
	return filePath;
};

export const cleanupTempFile = async (filePath: string | null) => {
	if (filePath) {
		await fs.unlink(filePath).catch(() => {});
	}
};

export const ensurePassfile = async () => {
	await fs.mkdir(path.dirname(RESTIC_PASS_FILE), { recursive: true });

	try {
		await fs.access(RESTIC_PASS_FILE);
	} catch {
		logger.info("Restic passfile not found, creating a new one...");
		await fs.writeFile(RESTIC_PASS_FILE, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
	}
};

export const cleanupTemporaryKeys = async (env: Record<string, string>) => {
	if (env._SFTP_KEY_PATH) {
		await fs.unlink(env._SFTP_KEY_PATH).catch(() => {});
	}

	if (env._SFTP_KNOWN_HOSTS_PATH) {
		await fs.unlink(env._SFTP_KNOWN_HOSTS_PATH).catch(() => {});
	}

	if (env.RESTIC_PASSWORD_FILE && env.RESTIC_PASSWORD_FILE !== RESTIC_PASS_FILE) {
		await fs.unlink(env.RESTIC_PASSWORD_FILE).catch(() => {});
	}

	if (env.GOOGLE_APPLICATION_CREDENTIALS) {
		await fs.unlink(env.GOOGLE_APPLICATION_CREDENTIALS).catch(() => {});
	}

	if (env.RESTIC_CACERT) {
		await fs.unlink(env.RESTIC_CACERT).catch(() => {});
	}
};

export const addCommonArgs = (args: string[], env: Record<string, string>) => {
	args.push("--json");

	if (env._SFTP_SSH_ARGS) {
		args.push("-o", `sftp.args=${env._SFTP_SSH_ARGS}`);
	}

	if (env._INSECURE_TLS === "true") {
		args.push("--insecure-tls");
	}

	if (env.RESTIC_CACERT) {
		args.push("--cacert", env.RESTIC_CACERT);
	}
};
