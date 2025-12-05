import * as fs from "node:fs/promises";
import Docker from "dockerode";
import { logger } from "../utils/logger";

export type SystemCapabilities = {
	docker: boolean;
	rclone: boolean;
};

let capabilitiesPromise: Promise<SystemCapabilities> | null = null;

/**
 * Returns the current system capabilities.
 * On first call, detects all capabilities and caches the promise.
 * Subsequent calls return the same cached promise, ensuring detection only happens once.
 */
export async function getCapabilities(): Promise<SystemCapabilities> {
	if (capabilitiesPromise === null) {
		// Start detection and cache the promise
		capabilitiesPromise = detectCapabilities();
	}

	return capabilitiesPromise;
}

/**
 * Detects which optional capabilities are available in the current environment
 */
async function detectCapabilities(): Promise<SystemCapabilities> {
	return {
		docker: await detectDocker(),
		rclone: await detectRclone(),
	};
}

export const parseDockerHost = (dockerHost?: string) => {
	const match = dockerHost?.match(/^(ssh|http|https):\/\/([^:]+)(?::(\d+))?$/);
	if (match) {
		const protocol = match[1] as "ssh" | "http" | "https";
		const host = match[2];
		const port = match[3] ? parseInt(match[3], 10) : undefined;
		return { protocol, host, port };
	}

	return {};
};

/**
 * Checks if Docker is available by:
 * 1. Checking if /var/run/docker.sock exists and is accessible
 * 2. Attempting to ping the Docker daemon
 */
async function detectDocker(): Promise<boolean> {
	try {
		const docker = new Docker(parseDockerHost(process.env.DOCKER_HOST));
		await docker.ping();

		logger.info("Docker capability: enabled");
		return true;
	} catch (_) {
		logger.warn(
			"Docker capability: disabled. " +
				"To enable: mount /var/run/docker.sock and /run/docker/plugins in docker-compose.yml",
		);
		return false;
	}
}

/**
 * Checks if rclone is available by:
 * 1. Checking if /root/.config/rclone directory exists and is accessible
 */
async function detectRclone(): Promise<boolean> {
	try {
		await fs.access("/root/.config/rclone");

		logger.info("rclone capability: enabled");
		return true;
	} catch (_) {
		logger.warn("rclone capability: disabled. " + "To enable: mount /root/.config/rclone in docker-compose.yml");
		return false;
	}
}
