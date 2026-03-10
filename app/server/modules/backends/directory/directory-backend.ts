import * as fs from "node:fs/promises";
import { toMessage } from "../../../utils/errors";
import { logger } from "@zerobyte/core/utils";
import type { VolumeBackend } from "../backend";
import { BACKEND_STATUS, type BackendConfig } from "~/schemas/volumes";

const mount = async (config: BackendConfig, _volumePath: string) => {
	if (config.backend !== "directory") {
		return { status: BACKEND_STATUS.error, error: "Invalid backend type" };
	}

	logger.info("Mounting directory volume from:", config.path);

	try {
		await fs.access(config.path);
		const stats = await fs.stat(config.path);

		if (!stats.isDirectory()) {
			return { status: BACKEND_STATUS.error, error: "Path is not a directory" };
		}

		return { status: BACKEND_STATUS.mounted };
	} catch (error) {
		logger.error("Failed to mount directory volume:", error);
		return { status: BACKEND_STATUS.error, error: toMessage(error) };
	}
};

const unmount = async () => {
	logger.info("Cannot unmount directory volume.");
	return { status: BACKEND_STATUS.unmounted };
};

const checkHealth = async (config: BackendConfig) => {
	if (config.backend !== "directory") {
		return { status: BACKEND_STATUS.error, error: "Invalid backend type" };
	}

	try {
		await fs.access(config.path);

		return { status: BACKEND_STATUS.mounted };
	} catch (error) {
		logger.error("Directory health check failed:", error);
		return { status: BACKEND_STATUS.error, error: toMessage(error) };
	}
};

export const makeDirectoryBackend = (config: BackendConfig, volumePath: string): VolumeBackend => ({
	mount: () => mount(config, volumePath),
	unmount,
	checkHealth: () => checkHealth(config),
});
