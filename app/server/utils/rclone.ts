import { logger } from "./logger";
import { toMessage } from "./errors";
import { exec } from "./spawn";

/**
 * List all configured rclone remotes
 * @returns Array of remote names
 */
export async function listRcloneRemotes(): Promise<string[]> {
	const result = await exec({ command: "rclone", args: ["listremotes"] });

	if (result.exitCode !== 0) {
		logger.error(`Failed to list rclone remotes: ${result.stderr.toString()}`);
		return [];
	}

	// Parse output - each line is a remote name ending with ":"
	const remotes = result.stdout
		.toString()
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.endsWith(":"))
		.map((line) => line.slice(0, -1)); // Remove trailing ":"

	return remotes;
}

/**
 * Get information about a specific rclone remote
 * @param remote Remote name
 * @returns Remote type and configuration info
 */
export async function getRcloneRemoteInfo(
	remote: string,
): Promise<{ type: string; config: Record<string, string> } | null> {
	try {
		const result = await exec({ command: "rclone", args: ["config", "show", remote] });

		if (result.exitCode !== 0) {
			logger.error(`Failed to get info for remote ${remote}: ${result.stderr.toString()}`);
			return null;
		}

		// Parse the output to extract type and config
		const output = result.stdout.toString();
		const lines = output
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l);

		const config: Record<string, string> = {};
		let type = "unknown";

		for (const line of lines) {
			if (line.includes("=")) {
				const parts = line.split("=");
				const key = parts[0];
				if (!key) continue;

				const valueParts = parts.slice(1);
				const value = valueParts.join("=").trim();
				const cleanKey = key.trim();

				if (cleanKey === "type") {
					type = value;
				}

				config[cleanKey] = value;
			}
		}

		return { type, config };
	} catch (error) {
		logger.error(`Error getting remote info for ${remote}: ${toMessage(error)}`);
		return null;
	}
}
