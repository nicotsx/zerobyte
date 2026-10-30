import { isDeepStrictEqual } from "node:util";
import type { SecretTransformer } from "./crypto";
import { preserveOrSealSecret, STORED_SECRET } from "./stored-secret";

export type SecretAccessor<TConfig> = {
	read: (config: TConfig) => string | undefined;
	write: (config: TConfig, value: string) => TConfig;
};

export type ConfigSecretPolicy<TConfig> = {
	secrets: readonly SecretAccessor<TConfig>[];
	sameAuthority: (stored: TConfig, submitted: TConfig) => boolean | Promise<boolean>;
};

export const secretAccessor = <TConfig>(
	read: SecretAccessor<TConfig>["read"],
	write: SecretAccessor<TConfig>["write"],
): SecretAccessor<TConfig> => ({ read, write });

export const transformConfigSecrets = async <TConfig>(
	config: TConfig,
	policy: ConfigSecretPolicy<TConfig>,
	transform: SecretTransformer,
) => {
	let transformed = config;

	for (const secret of policy.secrets) {
		const value = secret.read(transformed);
		if (!value) continue;

		transformed = secret.write(transformed, await transform(value));
	}

	return transformed;
};

export const redactConfigSecrets = <TConfig>(config: TConfig, policy: ConfigSecretPolicy<TConfig>) => {
	let redacted = config;

	for (const secret of policy.secrets) {
		if (!secret.read(redacted)) continue;
		redacted = secret.write(redacted, STORED_SECRET);
	}

	return redacted;
};

export const prepareSecretConfigUpdate = async <TConfig>(
	stored: TConfig | undefined,
	submitted: TConfig,
	policy: ConfigSecretPolicy<TConfig>,
) => {
	const allowPreserve = stored !== undefined && (await policy.sameAuthority(stored, submitted));
	let config = submitted;

	for (const secret of policy.secrets) {
		const submittedValue = secret.read(config);
		if (!submittedValue) continue;

		const storedValue = stored ? secret.read(stored) : undefined;
		const preparedValue = await preserveOrSealSecret(submittedValue, storedValue, allowPreserve);
		config = secret.write(config, preparedValue);
	}

	return { config, changed: stored === undefined || !isDeepStrictEqual(stored, config) };
};
