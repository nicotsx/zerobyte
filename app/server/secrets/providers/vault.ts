import type { HashiCorpVaultConfig, SecretBrowserNode, BrowsableSecretProvider } from "../types";
import { maskSecretRef } from "../utils";
import { BaseSecretProvider } from "./base";

/** Default URI scheme for HashiCorp Vault provider */
const DEFAULT_SCHEME = "vault";

/** Default secrets engine mount path */
const DEFAULT_MOUNT_PATH = "secret";

/**
 * HashiCorp Vault API response types
 */
interface VaultHealthResponse {
	initialized: boolean;
	sealed: boolean;
	version: string;
}

interface VaultSecretResponse {
	data: {
		data: Record<string, string>;
		metadata?: {
			created_time: string;
			version: number;
		};
	};
}

interface VaultListResponse {
	data: {
		keys: string[];
	};
}

/**
 * HashiCorp Vault Secret Provider
 *
 * Retrieves secrets from HashiCorp Vault using the HTTP API.
 * Supports KV v2 secrets engine.
 *
 * Format: vault://path/to/secret:key
 *
 * @example
 * vault://infrastructure/aws/access-key
 * vault://database/postgres:password
 * vault://app/config:api-key
 *
 * @see https://developer.hashicorp.com/vault/api-docs
 */
export class HashiCorpVaultProvider extends BaseSecretProvider implements BrowsableSecretProvider {
	readonly scheme: string;
	readonly name = "HashiCorp Vault Provider";

	private readonly addr: string;
	private readonly token: string;
	private readonly namespace?: string;
	private readonly mountPath: string;
	private readonly verifySsl: boolean;

	constructor(config: HashiCorpVaultConfig, customPrefix?: string) {
		super();
		this.addr = config.vaultAddr.replace(/\/$/, ""); // Remove trailing slash
		this.token = config.vaultToken;
		this.namespace = config.vaultNamespace;
		this.mountPath = config.mountPath || DEFAULT_MOUNT_PATH;
		this.verifySsl = config.verifySsl ?? true;
		this.scheme = customPrefix || DEFAULT_SCHEME;
	}

	/**
	 * Make a fetch request with optional SSL verification bypass
	 */
	private async fetchWithOptions(url: string, options: RequestInit = {}): Promise<Response> {
		const fetchOptions: RequestInit & { tls?: { rejectUnauthorized: boolean } } = {
			...options,
			headers: {
				...this.getHeaders(),
				...(options.headers || {}),
			},
		};

		// Bun supports tls options directly in fetch
		if (!this.verifySsl) {
			(fetchOptions as unknown as { tls: { rejectUnauthorized: boolean } }).tls = { rejectUnauthorized: false };
		}

		return fetch(url, fetchOptions);
	}

	/**
	 * Parse a Vault reference into path and optional key
	 * Format: vault://path/to/secret or vault://path/to/secret:key
	 */
	private parseRef(ref: string): { path: string; key?: string } {
		// Remove scheme prefix
		const withoutScheme = ref.replace(/^[a-z-]+:\/\//, "");

		// Check for key separator
		const colonIndex = withoutScheme.lastIndexOf(":");
		if (colonIndex > 0 && !withoutScheme.substring(colonIndex).includes("/")) {
			return {
				path: withoutScheme.substring(0, colonIndex),
				key: withoutScheme.substring(colonIndex + 1),
			};
		}

		return { path: withoutScheme };
	}

	async get(ref: string): Promise<string> {
		const { path, key } = this.parseRef(ref);

		this.log(`Fetching secret: ${maskSecretRef(ref)}`);

		try {
			const url = `${this.addr}/v1/${this.mountPath}/data/${path}`;
			const response = await this.fetchWithOptions(url);

			if (!response.ok) {
				if (response.status === 404) {
					throw new Error(`Secret not found at path "${path}"`);
				}
				if (response.status === 403) {
					throw new Error("Permission denied: Token does not have access to this secret");
				}
				throw new Error(`Failed to fetch secret: ${response.status} ${response.statusText}`);
			}

			const result = (await response.json()) as VaultSecretResponse;
			const secretData = result.data?.data;

			if (!secretData) {
				throw new Error(`No data found at path "${path}"`);
			}

			// If a key is specified, return that specific value
			if (key) {
				if (!(key in secretData)) {
					const availableKeys = Object.keys(secretData).join(", ");
					throw new Error(`Key "${key}" not found in secret. Available keys: ${availableKeys}`);
				}
				return secretData[key];
			}

			// If no key specified and only one key exists, return that value
			const keys = Object.keys(secretData);
			if (keys.length === 1) {
				return secretData[keys[0]];
			}

			// If multiple keys and no key specified, return the "value" key if it exists
			if ("value" in secretData) {
				return secretData.value;
			}

			// Otherwise return JSON of all values
			return JSON.stringify(secretData);
		} catch (error) {
			this.logError(`Failed to fetch secret: ${maskSecretRef(ref)}`, error);
			throw error;
		}
	}

	async healthCheck(): Promise<boolean> {
		try {
			// Check Vault health endpoint (doesn't require authentication)
			const healthResponse = await this.fetchWithOptions(`${this.addr}/v1/sys/health`, {
				headers: {}, // No auth needed for health check
			});

			// Vault returns different status codes based on state:
			// 200 = initialized, unsealed, active
			// 429 = unsealed, standby
			// 472 = DR secondary
			// 473 = Performance standby
			// 501 = not initialized
			// 503 = sealed
			if (healthResponse.status === 501) {
				throw new Error("Vault is not initialized");
			}
			if (healthResponse.status === 503) {
				throw new Error("Vault is sealed");
			}

			const health = (await healthResponse.json()) as VaultHealthResponse;

			if (health.sealed) {
				throw new Error("Vault is sealed");
			}

			// Verify token by attempting to look up self
			const tokenResponse = await this.fetchWithOptions(`${this.addr}/v1/auth/token/lookup-self`);
			if (!tokenResponse.ok) {
				if (tokenResponse.status === 403) {
					throw new Error("Authentication failed: Invalid or expired token");
				}
				throw new Error(`Token verification failed: ${tokenResponse.status} ${tokenResponse.statusText}`);
			}

			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// Check for common SSL errors
			if (
				message.includes("CERT") ||
				message.includes("certificate") ||
				message.includes("SSL") ||
				message.includes("self-signed") ||
				message.includes("self signed")
			) {
				throw new Error(
					`SSL certificate error: ${message}. Try enabling "Skip SSL Verification" if using a self-signed certificate.`,
				);
			}
			// Check for connection errors
			if (message.includes("ECONNREFUSED") || message.includes("ENOTFOUND") || message.includes("fetch failed")) {
				throw new Error(`Connection failed to ${this.addr}: ${message}. Check that Vault is running and accessible.`);
("ECONNREFUSED") || message.includes("ENOTFOUND") || message.includes("fetch failed")) {
				throw new Error(
					`Connection failed to ${this.addr}: ${message}. Check that Vault is running and accessible.`,
				);
			}
			throw error;
		}
	}

	/**
	 * Browse available secrets
	 * @param path - Optional path: empty 	 */
	private async listSecrets(path: string): Promise<SecretBrowserNode[]> {
		try {
			// List endpoint for KV v2 - use GET with list=true query param
			// (the LIST HTTP method is not universally supported)
			const url = `${this.addr}/v1/${this.mountPath}/metadata/${path}?list=true`;
			const response = await this.fetchWithOptions(url, {
				method: "GET",
			});

			if (!response.ok) {
				if (response.status === 404) {
					// Path might be a secret, try to read it to get keys
					return this.listSecretKeys(path);
				}
				if (response.status === 403) {
					throw new Error("Permission denied: Token does not have list access");
				}
				throw new Error(`Failed to list secrets: ${response.status} ${response.statusText}`);
			}

			const result = (await response.json()) as VaultListResponse;
			const keys = result.data?.keys || [];

			const nodes: SecretBrowserNode[] = []; to list secrets: ${response.status} ${response.statusText}`);
			}

			const result = (await response.json()) as VaultListResponse;
			const keys = result.data?.keys || [];

			const nodes: SecretBrowserNode[] = [];

			for (const key of keys) {
				const isFolder = key.endsWith("/");
				const name = isFolder ? key.slice(0, -1) : key;
				const fullPath = path ? `${path}/${name}` : name;

				if (isFolder) {
					nodes.push({
						id: fullPath,
						name,
						type: "folder",
						hasChildren: true,
					});
				} else {
					// It's a secret - check if it has multiple keys
					nodes.push({
						id: fullPath,
						name,
						type: "item",
						hasChildren: true, // Secrets can have multiple keys
					});
				}
			}

			return nodes;
		} catch (error) {
			this.logError(`Failed to list secrets at path "${path}"`, error);
			throw error;
		}
	}

	/**
	 * List keys within a specific secret
	 */
	private async listSecretKeys(path: string): Promise<SecretBrowserNode[]> {
		try {
			const url = `${this.addr}/v1/${this.mountPath}/data/${path}`;
			const response = await this.fetchWithOptions(url);

			if (!response.ok) {
				if (response.status === 404) {
					return [];
				}
				throw new Error(`Failed to read secret: ${response.status} ${response.statusText}`);
			}

			const result = (await response.json()) as VaultSecretResponse;
			const secretData = result.data?.data;

			if (!secretData) {
				return [];
			}

			return Object.keys(secretData).map((key) => ({
				id: `${path}:${key}`,
				name: key,
				type: "field" as const,
				uri: `${this.scheme}://${path}:${key}`,
				hasChildren: false,
			}));
		} catch (error) {
			this.logError(`Failed to list secret keys at path "${path}"`, error);
			throw error;
		}
	}

	/**
	 * Get authorization headers for API requests
	 */
	private getHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"X-Vault-Token": this.token,
			"Content-Type": "application/json",
		};

		if (this.namespace) {
			headers["X-Vault-Namespace"] = this.namespace;
		}

		return headers;
	}
}
