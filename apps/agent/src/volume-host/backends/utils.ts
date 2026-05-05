import * as fs from "node:fs/promises";
import { logger, safeExec } from "@zerobyte/core/node";
import { getMountForPath } from "../fs";

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

export const executeUnmount = async (mountPath: string): Promise<void> => {
	logger.debug(`Executing umount -l ${mountPath}`);
	const result = await safeExec({ command: "umount", args: ["-l", mountPath], timeout: 10000 });
	const stderr = result.stderr.toString();

	if (stderr.trim()) logger.warn(stderr.trim());
	if (result.exitCode !== 0) {
		throw new Error(`Mount command failed with exit code ${result.exitCode}: ${stderr.trim()}`);
	}
};

export const assertMounted = async (mountPath: string, isExpectedFilesystem: (fstype: string) => boolean) => {
	try {
		await fs.access(mountPath);
	} catch {
		throw new Error("Volume is not mounted");
	}

	const mount = await getMountForPath(mountPath);
	if (!mount || mount.mountPoint !== mountPath) {
		throw new Error("Volume is not mounted");
	}
	if (!isExpectedFilesystem(mount.fstype)) {
		throw new Error(`Path ${mountPath} is not mounted as correct fstype (found ${mount.fstype}).`);
	}
};
