import * as fs from "node:fs/promises";
import { logger } from "../utils/logger";

export type SystemCapabilities = {
	rclone: boolean;
	sysAdmin: boolean;
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
		sysAdmin: await detectSysAdmin(),
	};
}

/**
 * Checks if rclone is available by:
 * 1. Checking if /root/.config/rclone directory exists and is accessible
 */
async function detectRclone(): Promise<boolean> {
	try {
		await fs.access("/root/.config/rclone");

		// Make sure the folder is not empty
		const files = await fs.readdir("/root/.config/rclone");
		if (files.length === 0) {
			throw new Error("rclone config directory is empty");
		}

		logger.info("rclone capability: enabled");
		return true;
	} catch (_) {
		logger.warn("rclone capability: disabled. " + "To enable: mount /root/.config/rclone in docker-compose.yml");
		return false;
	}
}

async function detectSysAdmin(): Promise<boolean> {
	try {
		const procStatus = await fs.readFile("/proc/self/status", "utf-8");

		const capEffLine = procStatus.split("\n").find((line) => line.startsWith("CapEff:"));

		if (!capEffLine) {
			logger.warn("sysAdmin capability: disabled. Could not read CapEff from /proc/self/status");
			return false;
		}

		// Extract the hex value (e.g., "00000000a80425fb")
		const capEffHex = capEffLine.split(/\s+/)[1];

		if (!capEffHex) {
			logger.warn("sysAdmin capability: disabled. Could not parse CapEff value");
			return false;
		}

		// Check if bit 21 (CAP_SYS_ADMIN) is set
		const capValue = parseInt(capEffHex, 16) & (1 << 21);

		if (capValue !== 0) {
			logger.info("sysAdmin capability: enabled (CAP_SYS_ADMIN detected)");
			return true;
		}

		logger.warn("sysAdmin capability: disabled. " + "To enable: add 'cap_add: SYS_ADMIN' in docker-compose.yml");
		return false;
	} catch (_error) {
		logger.warn("sysAdmin capability: disabled. " + "To enable: add 'cap_add: SYS_ADMIN' in docker-compose.yml");
		return false;
	}
}
