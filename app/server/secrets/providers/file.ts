import fs from "node:fs/promises";
import path from "node:path";
import type { SecretBrowserNode, BrowsableSecretProvider } from "../types";
import { BaseSecretProvider } from "./base";

/**
 * The only directory where file secrets can be read from
 * This is the standard Docker secrets mount point
 */
const SECRETS_DIRECTORY = "/run/secrets";

/**
 * File Secret Provider
 *
 * Retrieves secrets from files in /run/secrets/ (Docker secrets).
 * For security, only files within this directory are accessible.
 *
 * Format: file://secret_name (automatically reads from /run/secrets/secret_name)
 *
 * @example
 * file://db_password -> reads /run/secrets/db_password
 * file://api_key -> reads /run/secrets/api_key
 */
export class FileSecretProvider extends BaseSecretProvider implements BrowsableSecretProvider {
	readonly scheme: string;
	readonly name = "File Secret Provider";

	constructor(customPrefix?: string) {
		super();
		this.scheme = customPrefix || "file";
	}

	/**
	 * Parse file reference and return the full path
	 * file://secret_name -> /run/secrets/secret_name
	 */
	private parseRef(ref: string): string {
		const prefix = `${this.scheme}://`;
		if (!ref.startsWith(prefix)) {
			throw new Error(`Invalid file reference: ${ref}`);
		}
		const secretName = ref.slice(prefix.length);
		// Remove any leading slashes to normalize
		const normalizedName = secretName.replace(/^\/+/, "");
		return path.join(SECRETS_DIRECTORY, normalizedName);
	}

	async get(ref: string): Promise<string> {
		const filePath = this.parseRef(ref);

		this.log(`Reading secret from file: ${filePath}`);

		try {
			const content = await fs.readFile(filePath, "utf-8");
			// Trim trailing newlines (common in secret files)
			return content.trim();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new Error(`Secret file not found: ${filePath}`);
			}
			if ((error as NodeJS.ErrnoException).code === "EACCES") {
				throw new Error(`Permission denied reading secret file: ${filePath}`);
			}
			throw new Error(`Failed to read secret file ${filePath}: ${(error as Error).message}`);
		}
	}

	async healthCheck(): Promise<boolean> {
		// File provider is always available (actual file access is checked on get)
		return true;
	}

	/**
	 * Browse files in /run/secrets/
	 * Only lists the root directory - no subdirectories supported for security
	 */
	async browse(_browsePath?: string): Promise<SecretBrowserNode[]> {
		try {
			// Check if directory exists
			await fs.access(SECRETS_DIRECTORY);

			const entries = await fs.readdir(SECRETS_DIRECTORY, { withFileTypes: true });
			const nodes: SecretBrowserNode[] = [];

			for (const entry of entries) {
				// Only list files, not subdirectories (Docker secrets are flat)
				if (entry.isFile()) {
					nodes.push({
						id: entry.name,
						name: entry.name,
						type: "field",
						// Simple URI format: file://secret_name
						uri: `${this.scheme}://${entry.name}`,
						hasChildren: false,
					});
				}
			}

			return nodes.sort((a, b) => a.name.localeCompare(b.name));
		} catch {
			// Directory doesn't exist or isn't accessible
			return [];
		}
	}
}
