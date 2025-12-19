import * as fs from "node:fs/promises";
import * as npath from "node:path";
import { toMessage } from "../../../utils/errors";
import { logger } from "../../../utils/logger";
import { $ } from "bun";

export const executeMount = async (args: string[]): Promise<void> => {
	let stderr: string | undefined;

	logger.debug(`Executing mount ${args.join(" ")}`);
	const result = await $`mount ${args}`.nothrow();
	stderr = result.stderr.toString();

	if (stderr?.trim()) {
		logger.warn(stderr.trim());
	}

	if (result.exitCode !== 0) {
		throw new Error(`Mount command failed with exit code ${result.exitCode}: ${stderr?.trim()}`);
	}
};

export const executeUnmount = async (path: string): Promise<void> => {
	let stderr: string | undefined;

	logger.debug(`Executing umount -l ${path}`);
	const result = await $`umount -l ${path}`.nothrow();
	stderr = result.stderr.toString();

	if (stderr?.trim()) {
		logger.warn(stderr.trim());
	}

	if (result.exitCode !== 0) {
		throw new Error(`Mount command failed with exit code ${result.exitCode}: ${stderr?.trim()}`);
	}
};

export const createTestFile = async (path: string): Promise<void> => {
	const testFilePath = npath.join(path, `.healthcheck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

	await fs.writeFile(testFilePath, "healthcheck");

	const files = await fs.readdir(path);
	await Promise.all(
		files.map(async (file) => {
			if (file.startsWith(".healthcheck-")) {
				const filePath = npath.join(path, file);
				try {
					await fs.unlink(filePath);
				} catch (err) {
					logger.warn(`Failed to stat or unlink file ${filePath}: ${toMessage(err)}`);
				}
			}
		}),
	);
};
