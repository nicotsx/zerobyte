import * as fs from "node:fs/promises";
import { logger } from "../utils/logger";

export type SystemCapabilities = {
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
		rclone: await detectRclone(),
	};
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
