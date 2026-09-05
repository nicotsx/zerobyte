import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { MAX_AGENT_TRUSTED_ROOTS } from "@zerobyte/contracts/agent-protocol";
import {
	trustedRootDescriptorSchema,
	trustedSourceReferenceSchema,
	normalizeTrustedSourceRelativePath,
	type TrustedRootDescriptor,
	type TrustedSourceReference,
} from "@zerobyte/contracts/volumes";

export const BUILTIN_COMPATIBILITY_ROOT_ID = "local-filesystem";

const configuredRootSchema = z.object({
	id: trustedRootDescriptorSchema.shape.id,
	label: trustedRootDescriptorSchema.shape.label,
	path: z.string().trim().min(1),
	allowBackup: z.boolean().default(true),
});

const configuredRootsSchema = z
	.array(configuredRootSchema)
	.max(MAX_AGENT_TRUSTED_ROOTS, `ZEROBYTE_AGENT_ROOTS must contain at most ${MAX_AGENT_TRUSTED_ROOTS} roots`);

type ConfiguredRoot = z.infer<typeof configuredRootSchema>;

type TrustedRoot = {
	descriptor: TrustedRootDescriptor;
	configuredPath: string;
	canonicalPath: string;
};

export type TrustedRootRegistry = ReadonlyMap<string, TrustedRoot> & {
	readonly hasImplicitBuiltinCompatibilityRoot: boolean;
};

const expandHome = (configuredPath: string) => {
	if (configuredPath === "~") {
		return os.homedir();
	}

	if (configuredPath.startsWith("~/") || configuredPath.startsWith("~\\")) {
		return path.join(os.homedir(), configuredPath.slice(2));
	}

	if (configuredPath.startsWith("~")) {
		throw new Error(`Trusted root path does not support another user's home: ${configuredPath}`);
	}

	return configuredPath;
};

const parseConfiguredRoots = (rawValue: string): ConfiguredRoot[] => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawValue);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`ZEROBYTE_AGENT_ROOTS must be valid JSON: ${message}`);
	}

	const result = configuredRootsSchema.safeParse(parsed);

	if (!result.success) {
		throw new Error(`Invalid ZEROBYTE_AGENT_ROOTS: ${result.error.message}`);
	}

	return result.data;
};

const assertUniqueRootFields = (roots: ConfiguredRoot[]) => {
	const ids = new Set<string>();
	const labels = new Set<string>();

	for (const root of roots) {
		const normalizedLabel = root.label.toLocaleLowerCase();
		if (ids.has(root.id)) {
			throw new Error(`ZEROBYTE_AGENT_ROOTS contains duplicate id "${root.id}"`);
		}
		if (labels.has(normalizedLabel)) {
			throw new Error(`ZEROBYTE_AGENT_ROOTS contains duplicate label "${root.label}"`);
		}

		ids.add(root.id);
		labels.add(normalizedLabel);
	}
};

const canonicalizeRoot = (root: ConfiguredRoot): TrustedRoot => {
	const expandedPath = expandHome(root.path);
	const absolutePath = path.resolve(expandedPath);

	let canonicalPath: string;

	try {
		canonicalPath = fs.realpathSync.native(absolutePath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Trusted root "${root.id}" cannot be resolved: ${message}`);
	}

	const stats = fs.statSync(canonicalPath);

	if (!stats.isDirectory()) {
		throw new Error(`Trusted root "${root.id}" is not a directory`);
	}

	const descriptor = trustedRootDescriptorSchema.parse({
		id: root.id,
		label: root.label,
		canBackup: root.allowBackup,
	});

	return { descriptor, configuredPath: absolutePath, canonicalPath };
};

export const createTrustedRootRegistry = (options?: {
	rawRoots?: string;
	builtinLocal?: boolean;
}): TrustedRootRegistry => {
	const rawRoots = options?.rawRoots;
	const builtinLocal = options?.builtinLocal ?? false;
	const hasImplicitBuiltinCompatibilityRoot = rawRoots === undefined && builtinLocal;

	let configuredRoots: ConfiguredRoot[];

	if (rawRoots !== undefined) {
		configuredRoots = parseConfiguredRoots(rawRoots);
	} else if (builtinLocal) {
		configuredRoots = [
			{
				id: BUILTIN_COMPATIBILITY_ROOT_ID,
				label: "Local filesystem",
				path: path.parse(process.cwd()).root,
				allowBackup: true,
			},
		];
	} else {
		configuredRoots = [];
	}

	assertUniqueRootFields(configuredRoots);

	const entries = configuredRoots.map((root) => {
		const trustedRoot = canonicalizeRoot(root);

		return [root.id, trustedRoot] as const;
	});

	const registry = new Map(entries);

	return Object.assign(registry, { hasImplicitBuiltinCompatibilityRoot });
};

export const getTrustedRootDescriptors = (registry: TrustedRootRegistry) => {
	return [...registry.values()].map((root) => root.descriptor);
};

export const normalizeTrustedRelativePath = normalizeTrustedSourceRelativePath;

const isInsideRoot = (canonicalRoot: string, candidate: string) => {
	const relative = path.relative(canonicalRoot, candidate);
	return (
		relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
	);
};

export const resolveTrustedSourcePath = (registry: TrustedRootRegistry, referenceInput: TrustedSourceReference) => {
	const reference = trustedSourceReferenceSchema.parse(referenceInput);
	const root = registry.get(reference.rootId);

	if (!root) {
		throw new Error(`Unknown trusted root "${reference.rootId}"`);
	}

	const allowed = root.descriptor.canBackup;

	if (!allowed) {
		throw new Error(`Trusted root "${reference.rootId}" does not allow backups`);
	}

	const relativePath = normalizeTrustedRelativePath(reference.relativePath);
	const unresolvedPath = path.resolve(root.canonicalPath, relativePath);

	if (!isInsideRoot(root.canonicalPath, unresolvedPath)) {
		throw new Error("Trusted source path escapes its configured root");
	}

	let canonicalPath: string;

	try {
		canonicalPath = fs.realpathSync.native(unresolvedPath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Trusted source path resolution failed for root "${reference.rootId}": ${message}`);
		throw new Error("Trusted source path cannot be resolved");
	}

	if (!isInsideRoot(root.canonicalPath, canonicalPath)) {
		throw new Error("Trusted source path escapes its configured root through a symlink");
	}

	return { canonicalPath, relativePath, root };
};

let defaultRegistry: TrustedRootRegistry | null = null;

export const getDefaultTrustedRootRegistry = () => {
	if (!defaultRegistry) {
		const builtinLocal = process.env.ZEROBYTE_BUILTIN_LOCAL_AGENT === "1";

		defaultRegistry = createTrustedRootRegistry({
			rawRoots: process.env.ZEROBYTE_AGENT_ROOTS,
			builtinLocal,
		});
	}

	return defaultRegistry;
};
