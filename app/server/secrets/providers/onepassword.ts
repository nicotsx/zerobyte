import type { OnePasswordConfig, SecretBrowserNode, BrowsableSecretProvider } from "../types";
import { parseOnePasswordRef, maskSecretRef } from "../utils";
import { BaseSecretProvider } from "./base";

/** Default URI scheme for 1Password Connect provider */
const DEFAULT_SCHEME = "op";

/**
 * 1Password Connect API response types
 */
interface OnePasswordField {
	id: string;
	label: string;
	value: string;
	type: string;
}

interface OnePasswordItem {
	id: string;
	title: string;
	vault: { id: string; name: string };
	category: string;
	fields: OnePasswordField[];
}

interface OnePasswordVault {
	id: string;
	name: string;
}

/**
 * 1Password Connect Secret Provider
 *
 * Retrieves secrets from 1Password using the Connect API.
 * Requires a 1Password Connect server running and accessible.
 *
 * Format: op://vault/item/field
 *
 * @example
 * op://Infrastructure/AWS-Prod/access-key
 * op://Backups/Zerobyte/restic-password
 *
 * @see https://developer.1password.com/docs/connect
 */
export class OnePasswordConnectProvider extends BaseSecretProvider implements BrowsableSecretProvider {
	readonly scheme: string;
	readonly name = "1Password Connect Provider";

	private readonly host: string;
	private readonly token: string;
	private readonly verifySsl: boolean;

	/** Cache vault name -> vault ID mappings */
	private vaultCache: Map<string, string> = new Map();

	constructor(config: OnePasswordConfig, customPrefix?: string) {
		super();
		this.host = config.connectHost.replace(/\/$/, ""); // Remove trailing slash
		this.token = config.connectToken;
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

	async get(ref: string): Promise<string> {
		const { vault, item, field } = parseOnePasswordRef(ref);

		this.log(`Fetching secret: ${maskSecretRef(ref)}`);

		try {
			// Get vault ID from name
			const vaultId = await this.getVaultId(vault);

			// Get item from vault
			const itemData = await this.getItem(vaultId, item);

			// Find the field
			const fieldData = itemData.fields.find(
				(f) => f.label.toLowerCase() === field.toLowerCase() || f.id.toLowerCase() === field.toLowerCase(),
			);

			if (!fieldData) {
				const availableFields = itemData.fields.map((f) => f.label).join(", ");
				throw new Error(`Field "${field}" not found in item "${item}". Available fields: ${availableFields}`);
			}

			return fieldData.value;
		} catch (error) {
			this.logError(`Failed to fetch secret: ${maskSecretRef(ref)}`, error);
			throw error;
		}
	}

	async healthCheck(): Promise<boolean> {
		try {
			// First check if server is reachable
			const healthResponse = await this.fetchWithOptions(`${this.host}/health`);
			if (!healthResponse.ok) {
				const text = await healthResponse.text().catch(() => "");
				throw new Error(
					`Health check failed: ${healthResponse.status} ${healthResponse.statusText}${text ? ` - ${text}` : ""}`,
				);
			}

			// Then verify token by listing vaults (requires authentication)
			const vaultsResponse = await this.fetchWithOptions(`${this.host}/v1/vaults`);
			if (!vaultsResponse.ok) {
				if (vaultsResponse.status === 401) {
					throw new Error("Authentication failed: Invalid or expired Connect token");
				}
				throw new Error(`Failed to verify token: ${vaultsResponse.status} ${vaultsResponse.statusText}`);
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
				throw new Error(
					`Connection failed to ${this.host}: ${message}. Check that the Connect server is running and accessible.`,
				);
			}
			throw error;
		}
	}

	/**
	 * Get vault ID from vault name
	 */
	private async getVaultId(vaultName: string): Promise<string> {
		// Check cache first
		const cached = this.vaultCache.get(vaultName.toLowerCase());
		if (cached) {
			return cached;
		}

		const response = await this.fetchWithOptions(`${this.host}/v1/vaults`);

		if (!response.ok) {
			if (response.status === 401) {
				throw new Error("Authentication failed: Invalid or expired Connect token");
			}
			throw new Error(`Failed to list vaults: ${response.status} ${response.statusText}`);
		}

		const vaults = (await response.json()) as OnePasswordVault[];

		// Find vault by name (case-insensitive)
		const vault = vaults.find((v) => v.name.toLowerCase() === vaultName.toLowerCase());

		if (!vault) {
			const availableVaults = vaults.map((v) => v.name).join(", ");
			throw new Error(`Vault "${vaultName}" not found. Available vaults: ${availableVaults}`);
		}

		// Cache the mapping
		this.vaultCache.set(vaultName.toLowerCase(), vault.id);

		return vault.id;
	}

	/**
	 * Get item from vault by title
	 */
	private async getItem(vaultId: string, itemTitle: string): Promise<OnePasswordItem> {
		// First, list items to find by title
		const listResponse = await this.fetchWithOptions(`${this.host}/v1/vaults/${vaultId}/items`);

		if (!listResponse.ok) {
			throw new Error(`Failed to list items: ${listResponse.status} ${listResponse.statusText}`);
		}

		const items = (await listResponse.json()) as Array<{ id: string; title: string }>;

		// Find item by title (case-insensitive)
		const item = items.find((i) => i.title.toLowerCase() === itemTitle.toLowerCase());

		if (!item) {
			throw new Error(`Item "${itemTitle}" not found in vault`);
		}

		// Get full item details (including field values)
		const itemResponse = await this.fetchWithOptions(`${this.host}/v1/vaults/${vaultId}/items/${item.id}`);

		if (!itemResponse.ok) {
			throw new Error(`Failed to get item details: ${itemResponse.status} ${itemResponse.statusText}`);
		}

		return itemResponse.json() as Promise<OnePasswordItem>;
	}

	/**
	 * Browse available secrets
	 * @param path - Optional path: empty = list vaults, "vaultName" = list items, "vaultName/itemName" = list fields
	 */
	async browse(path?: string): Promise<SecretBrowserNode[]> {
		if (!path) {
			// List all vaults
			return this.listVaults();
		}

		const parts = path.split("/").filter(Boolean);
		if (parts.length === 1) {
			// List items in vault
			return this.listItems(parts[0]);
		}

		if (parts.length === 2) {
			// List fields in item
			return this.listFields(parts[0], parts[1]);
		}

		return [];
	}

	/**
	 * List all vaults
	 */
	private async listVaults(): Promise<SecretBrowserNode[]> {
		const response = await this.fetchWithOptions(`${this.host}/v1/vaults`);

		if (!response.ok) {
			if (response.status === 401) {
				throw new Error("Authentication failed: Invalid or expired Connect token");
			}
			throw new Error(`Failed to list vaults: ${response.status} ${response.statusText}`);
		}

		const vaults = (await response.json()) as OnePasswordVault[];

		return vaults.map((vault) => ({
			id: vault.id,
			name: vault.name,
			type: "vault" as const,
			hasChildren: true,
		}));
	}

	/**
	 * List all items in a vault
	 */
	private async listItems(vaultName: string): Promise<SecretBrowserNode[]> {
		const vaultId = await this.getVaultId(vaultName);
		const response = await this.fetchWithOptions(`${this.host}/v1/vaults/${vaultId}/items`);

		if (!response.ok) {
			throw new Error(`Failed to list items: ${response.status} ${response.statusText}`);
		}

		const items = (await response.json()) as Array<{ id: string; title: string }>;

		return items.map((item) => ({
			id: item.id,
			name: item.title,
			type: "item" as const,
			hasChildren: true,
		}));
	}

	/**
	 * List all fields in an item
	 */
	private async listFields(vaultName: string, itemTitle: string): Promise<SecretBrowserNode[]> {
		const vaultId = await this.getVaultId(vaultName);
		const item = await this.getItem(vaultId, itemTitle);

		return item.fields
			.filter((field) => field.value) // Only include fields that have values
			.map((field) => ({
				id: field.id,
				name: field.label || field.id,
				type: "field" as const,
				uri: `${this.scheme}://${vaultName}/${itemTitle}/${field.label || field.id}`,
				hasChildren: false,
			}));
	}

	/**
	 * Get authorization headers for API requests
	 */
	private getHeaders(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.token}`,
			"Content-Type": "application/json",
		};
	}
}
