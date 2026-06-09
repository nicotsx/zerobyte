import crypto, { type Argon2Algorithm, type Argon2Parameters } from "node:crypto";

const LEGACY_ALGORITHM = "argon2id" satisfies Argon2Algorithm;
const LEGACY_VERSION = "19";
const LEGACY_MEMORY = 65_536;
const LEGACY_PASSES = 2;
const LEGACY_PARALLELISM = 1;
const LEGACY_TAG_LENGTH = 32;
const LEGACY_SALT_LENGTH = 32;

type ParsedLegacyPasswordHash = {
	algorithm: Argon2Algorithm;
	memory: number;
	passes: number;
	parallelism: number;
	salt: Buffer;
	hash: Buffer;
};

const encodePhcBase64 = (value: Buffer) => value.toString("base64").replace(/=+$/, "");

const decodePhcBase64 = (value: string) => {
	const padding = "=".repeat((4 - (value.length % 4)) % 4);
	return Buffer.from(`${value}${padding}`, "base64");
};

const deriveLegacyPasswordHash = (algorithm: Argon2Algorithm, parameters: Argon2Parameters) =>
	new Promise<Buffer>((resolve, reject) => {
		const { argon2 } = crypto;
		argon2(algorithm, parameters, (error, derivedKey) => {
			if (error) {
				reject(error);
				return;
			}

			resolve(Buffer.from(derivedKey));
		});
	});

const parseLegacyPasswordHash = (hash: string): ParsedLegacyPasswordHash => {
	const [empty, algorithm, version, params, salt, digest, ...extra] = hash.split("$");

	if (
		empty !== "" ||
		(algorithm !== "argon2d" && algorithm !== "argon2i" && algorithm !== "argon2id") ||
		version !== `v=${LEGACY_VERSION}` ||
		!params ||
		!salt ||
		!digest ||
		extra.length > 0
	) {
		throw new Error("Invalid legacy password hash");
	}

	const parsedParams = Object.fromEntries(
		params.split(",").map((param) => {
			const [key, value] = param.split("=");
			if (!key || !value) {
				throw new Error("Invalid legacy password hash parameters");
			}
			return [key, Number(value)];
		}),
	);

	const memory = parsedParams.m;
	const passes = parsedParams.t;
	const parallelism = parsedParams.p;

	if (!memory || !passes || !parallelism) {
		throw new Error("Invalid legacy password hash parameters");
	}

	return {
		algorithm,
		memory,
		passes,
		parallelism,
		salt: decodePhcBase64(salt),
		hash: decodePhcBase64(digest),
	};
};

export const hashLegacyPassword = async (password: string) => {
	const salt = crypto.randomBytes(LEGACY_SALT_LENGTH);
	const hash = await deriveLegacyPasswordHash(LEGACY_ALGORITHM, {
		message: password,
		nonce: salt,
		parallelism: LEGACY_PARALLELISM,
		tagLength: LEGACY_TAG_LENGTH,
		memory: LEGACY_MEMORY,
		passes: LEGACY_PASSES,
	});

	return [
		"",
		LEGACY_ALGORITHM,
		`v=${LEGACY_VERSION}`,
		`m=${LEGACY_MEMORY},t=${LEGACY_PASSES},p=${LEGACY_PARALLELISM}`,
		encodePhcBase64(salt),
		encodePhcBase64(hash),
	].join("$");
};

export const verifyLegacyPassword = async (password: string, hash: string) => {
	try {
		const parsed = parseLegacyPasswordHash(hash);
		const derivedHash = await deriveLegacyPasswordHash(parsed.algorithm, {
			message: password,
			nonce: parsed.salt,
			parallelism: parsed.parallelism,
			tagLength: parsed.hash.length,
			memory: parsed.memory,
			passes: parsed.passes,
		});

		return parsed.hash.length === derivedHash.length && crypto.timingSafeEqual(parsed.hash, derivedHash);
	} catch {
		return false;
	}
};
