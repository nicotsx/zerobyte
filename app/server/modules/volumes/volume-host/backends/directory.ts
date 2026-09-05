import * as fs from "node:fs/promises";
import type { BackendConfig } from "@zerobyte/contracts/volumes";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import type { VolumeBackend } from "../types";

const checkHealth = async (config: BackendConfig) => {
	if (config.backend !== "directory") {
		return { status: "error" as const, error: "Invalid backend type" };
	}

	try {
		await fs.access(config.path);
		const stats = await fs.stat(config.path);

		if (!stats.isDirectory()) {
			return { status: "error" as const, error: "Path is not a directory" };
		}

		return { status: "mounted" as const };
	} catch (error) {
		logger.error("Directory health check failed:", error);
		return { status: "error" as const, error: toMessage(error) };
	}
};

export const makeDirectoryBackend = (config: BackendConfig, _: string): VolumeBackend => ({
	mount: () => checkHealth(config),
	unmount: () => checkHealth(config),
	checkHealth: () => checkHealth(config),
});
