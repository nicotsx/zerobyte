import * as fs from "node:fs/promises";
import { logger } from "@zerobyte/core/node";
import { safeExec } from "@zerobyte/core/node";
import { getMountForPath } from "../../../utils/mountinfo";

export const executeMount = async (args: string[]): Promise<void> => {
	const shouldBeVerbose = process.env.LOG_LEVEL === "debug" || process.env.NODE_ENV !== "production";
	const hasVerboseFlag = args.some((arg) => arg === "-v" || arg.startsWith("-vv"));
	const effectiveArgs = shouldBeVerbose && !hasVerboseFlag ? ["-v", ...args] : args;

	logger.debug(`Executing mount ${effectiveArgs.join(" ")}`);
	const result = await safeExec({ command: "mount", args: effectiveArgs, timeout: 10000 });

	const stdout = result.stdout.toString().trim();
	const stderr = result.stderr.toString().trim();

	if (result.exitCode === 0) {
		if (stdout) logger.debug(stdout);
		if (stderr) logger.debug(stderr);
		return;
	}

	if (stdout) logger.warn(stdout);
	if (stderr) logger.warn(stderr);

	throw new Error(`Mount command failed with exit code ${result.exitCode}: ${stderr || stdout || "unknown error"}`);
};

export const executeUnmount = async (path: string): Promise<void> => {
	let stderr: string | undefined;

	logger.debug(`Executing umount -l ${path}`);
	const result = await safeExec({ command: "umount", args: ["-l", path], timeout: 10000 });

	stderr = result.stderr.toString();

	if (stderr?.trim()) {
		logger.warn(stderr.trim());
	}

	if (result.exitCode !== 0) {
		throw new Error(`Mount command failed with exit code ${result.exitCode}: ${stderr?.trim()}`);
	}
};

export const assertMounted = async (path: string, isExpectedFilesystem: (fstype: string) => boolean) => {
	try {
		await fs.access(path);
	} catch {
		throw new Error("Volume is not mounted");
	}

	const mount = await getMountForPath(path);

	if (!mount || mount.mountPoint !== path) {
		throw new Error("Volume is not mounted");
	}

	if (!isExpectedFilesystem(mount.fstype)) {
		throw new Error(`Path ${path} is not mounted as correct fstype (found ${mount.fstype}).`);
	}
};
