import * as fs from "node:fs/promises";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import type { BackendConfig, VolumeBackend } from "../types";

const mount = async (config: BackendConfig) => {
	if (config.backend !== "directory") {
		return { status: "error" as const, error: "Invalid backend type" };
	}

	logger.info("Mounting directory volume from:", config.path);

	try {
		await fs.access(config.path);
		const stats = await fs.stat(config.path);

		if (!stats.isDirectory()) {
			return { status: "error" as const, error: "Path is not a directory" };
		}

		return { status: "mounted" as const };
	} catch (error) {
		logger.error("Failed to mount directory volume:", error);
		return { status: "error" as const, error: toMessage(error) };
	}
};

const unmount = async () => {
	logger.info("Cannot unmount directory volume.");
	return { status: "unmounted" as const };
};

const checkHealth = async (config: BackendConfig) => {
	if (config.backend !== "directory") {
		return { status: "error" as const, error: "Invalid backend type" };
	}

	try {
		await fs.access(config.path);

		return { status: "mounted" as const };
	} catch (error) {
		logger.error("Directory health check failed:", error);
		return { status: "error" as const, error: toMessage(error) };
	}
};

export const makeDirectoryBackend = (config: BackendConfig, _: string): VolumeBackend => ({
	mount: () => mount(config),
	unmount,
	checkHealth: () => checkHealth(config),
});
