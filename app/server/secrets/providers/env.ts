import type { SecretBrowserNode, BrowsableSecretProvider } from "../types";
import { parseEnvRef } from "../utils";
import { BaseSecretProvider } from "./base";

/**
 * Required prefix for environment variables used as secrets
 * env://MY_VAR will look up ENV_MY_VAR
 */
const ENV_VAR_PREFIX = "ENV_";

/**
 * Environment Variable Secret Provider
 *
 * Retrieves secrets from environment variables with ENV_ prefix.
 * For security, only ENV_ prefixed variables are accessible.
 *
 * Format: env://VAR_NAME (will look up ENV_VAR_NAME)
 *
 * @example
 * env://DB_PASSWORD -> reads ENV_DB_PASSWORD
 * env://AWS_SECRET_KEY -> reads ENV_AWS_SECRET_KEY
 */
export class EnvSecretProvider extends BaseSecretProvider implements BrowsableSecretProvider {
	readonly scheme: string;
	readonly name = "Environment Variable Provider";

	constructor(customPrefix?: string) {
		super();
		this.scheme = customPrefix || "env";
	}

	async get(ref: string): Promise<string> {
		const varName = parseEnvRef(ref);
		// Add ENV_ prefix to the requested variable name
		const actualVarName = `${ENV_VAR_PREFIX}${varName}`;

		this.log(`Fetching environment variable: ${actualVarName}`);

		const value = process.env[actualVarName];

		if (value === undefined) {
			throw new Error(`Environment variable not found: ${actualVarName} (referenced as ${varName})`);
		}

		if (value === "") {
			this.log(`Warning: Environment variable ${actualVarName} is empty`);
		}

		return value;
	}

	async healthCheck(): Promise<boolean> {
		// Environment provider is always available
		return true;
	}

	/**
	 * Browse available environment variables with ENV_ prefix
	 * Shows variables without the ENV_ prefix for cleaner display
	 */
	async browse(_path?: string): Promise<SecretBrowserNode[]> {
		const envVars = Object.keys(process.env)
			.filter((name) => name.startsWith(ENV_VAR_PREFIX))
			.sort();

		return envVars.map((name) => {
			// Strip the ENV_ prefix for display and URI
			const displayName = name.substring(ENV_VAR_PREFIX.length);
			return {
				id: name,
				name: displayName,
				type: "variable" as const,
				uri: `${this.scheme}://${displayName}`,
				hasChildren: false,
			};
		});
	}
}
