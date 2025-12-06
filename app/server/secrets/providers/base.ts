import type { SecretProvider, SecretScheme } from "../types";
import { getSecretScheme } from "../utils";
import { logger } from "../../utils/logger";

/**
 * Abstract base class for secret providers
 * Provides common functionality and structure for all providers
 */
export abstract class BaseSecretProvider implements SecretProvider {
	abstract readonly scheme: SecretScheme | string;
	abstract readonly name: string;

	/**
	 * Check if this provider can handle the given reference
	 */
	supports(ref: string): boolean {
		return getSecretScheme(ref) === this.scheme;
	}

	/**
	 * Retrieve the secret value - must be implemented by subclasses
	 */
	abstract get(ref: string): Promise<string>;

	/**
	 * Optional health check - can be overridden by subclasses
	 */
	async healthCheck(): Promise<boolean> {
		return true;
	}

	/**
	 * Log a debug message with provider context
	 */
	protected log(message: string, data?: Record<string, unknown>): void {
		if (data) {
			logger.debug(`[${this.name}] ${message}`, data);
		} else {
			logger.debug(`[${this.name}] ${message}`);
		}
	}

	/**
	 * Log an error with provider context
	 */
	protected logError(message: string, error?: unknown): void {
		if (error) {
			logger.error(`[${this.name}] ${message}`, { error });
		} else {
			logger.error(`[${this.name}] ${message}`);
		}
	}
}
