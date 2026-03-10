const DENIED_FLAGS = new Set<string>([
	"--password-command",
	"--password-file",
	"--password",
	"-p",
	"--repository",
	"--repository-file",
	"-r",
	"--option",
	"-o",
	"--key-hint",
	"--tls-client-cert",
	"--cacert",
	"--repo",
]);

type FlagSpec = {
	requiresValue: boolean;
	validateValue?: (value: string) => string | null;
};

const positiveIntegerValue = (value: string) => {
	return /^\d+$/.test(value) ? null : `Flag value "${value}" must be a positive integer`;
};

const FLAG_SPECS = new Map<string, FlagSpec>([
	["--verbose", { requiresValue: false }],
	["-v", { requiresValue: false }],
	["--no-scan", { requiresValue: false }],
	["--exclude-larger-than", { requiresValue: true }],
	["--skip-if-unchanged", { requiresValue: false }],
	["--exclude-caches", { requiresValue: false }],
	["--force", { requiresValue: false }],
	["--use-fs-snapshot", { requiresValue: false }],
	["--read-concurrency", { requiresValue: true, validateValue: positiveIntegerValue }],
	["--ignore-ctime", { requiresValue: false }],
	["--ignore-inode", { requiresValue: false }],
	["--with-atime", { requiresValue: false }],
	["--no-cache", { requiresValue: false }],
	["--cleanup-cache", { requiresValue: false }],
	["--limit-upload", { requiresValue: true, validateValue: positiveIntegerValue }],
	["--limit-download", { requiresValue: true, validateValue: positiveIntegerValue }],
	["--pack-size", { requiresValue: true, validateValue: positiveIntegerValue }],
	["--no-lock", { requiresValue: false }],
]);

const ALLOWED_FLAGS = [...FLAG_SPECS.keys()].join(", ");

function parseFlagToken(token: string) {
	const eqIdx = token.indexOf("=");

	return eqIdx === -1
		? { flag: token, inlineValue: null as string | null }
		: { flag: token.slice(0, eqIdx), inlineValue: token.slice(eqIdx + 1) };
}

function validateFlagValue(flag: string, value: string, spec: FlagSpec): string | null {
	if (!value) {
		return `Flag "${flag}" requires a value`;
	}

	if (value.startsWith("-")) {
		return `Flag "${flag}" requires a value, but received "${value}"`;
	}

	return spec.validateValue?.(value) ?? null;
}

export function validateCustomResticParams(params: string[]): string | null {
	for (const param of params) {
		const tokens = param.trim().split(/\s+/).filter(Boolean);

		for (let index = 0; index < tokens.length; index += 1) {
			const token = tokens[index];

			if (!token?.startsWith("-")) {
				return `Unexpected positional argument "${token}" in customResticParams`;
			}

			const { flag, inlineValue } = parseFlagToken(token);

			if (DENIED_FLAGS.has(flag)) {
				return `Flag "${flag}" is not permitted in customResticParams`;
			}

			const spec = FLAG_SPECS.get(flag);
			if (!spec) {
				return `Unknown or unsupported flag "${flag}" in customResticParams. Permitted flags: ${ALLOWED_FLAGS}`;
			}

			if (!spec.requiresValue) {
				if (inlineValue !== null && inlineValue !== "") {
					return `Flag "${flag}" does not accept a value`;
				}
				continue;
			}

			if (inlineValue !== null) {
				const error = validateFlagValue(flag, inlineValue, spec);
				if (error) {
					return error;
				}
				continue;
			}

			const nextToken = tokens[index + 1];
			if (!nextToken) {
				return `Flag "${flag}" requires a value`;
			}

			const error = validateFlagValue(flag, nextToken, spec);
			if (error) {
				return error;
			}

			index += 1;
		}
	}

	return null;
}
