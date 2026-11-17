import * as fs from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { reportSourceError } from "./filesystem-paths";
import { z } from "zod";
import { MAX_AGENT_TRUSTED_ROOTS } from "@zerobyte/contracts/agent-protocol";
import {
	getLocalFilesystemRootId,
	trustedRootAllows,
	trustedRootDescriptorSchema,
	filesystemSourceSchema,
	normalizeTrustedSourceRelativePath,
	type TrustedRootDescriptor,
	type TrustedRootPurpose,
	type FilesystemSource,
} from "@zerobyte/contracts/volumes";
import type { RepositoryConfig } from "@zerobyte/core/restic";

const configuredRootSchema = z.object({
	id: trustedRootDescriptorSchema.shape.id,
	label: trustedRootDescriptorSchema.shape.label,
	path: z.string().trim().min(1),
	allowBackup: z.boolean().default(true),
	/** Whether repositories may be stored inside this root. Off unless explicitly enabled. */
	allowRepository: z.boolean().optional(),
});

export const configuredRootsSchema = z
	.array(configuredRootSchema)
	.max(MAX_AGENT_TRUSTED_ROOTS, `ZEROBYTE_AGENT_ROOTS must contain at most ${MAX_AGENT_TRUSTED_ROOTS} roots`);

export type ConfiguredRoot = z.infer<typeof configuredRootSchema>;

type TrustedRoot = {
	descriptor: TrustedRootDescriptor;
	canonicalPath: string;
};

export type TrustedRootRegistry = ReadonlyMap<string, TrustedRoot>;

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

export const resolveConfiguredRootPath = (configuredPath: string) => path.resolve(expandHome(configuredPath));

export const parseConfiguredRoots = (rawValue: string): ConfiguredRoot[] => {
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

	assertUniqueRootFields(result.data);

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
	const absolutePath = resolveConfiguredRootPath(root.path);

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
		canStoreRepository: root.allowRepository === true,
	});

	return { descriptor, canonicalPath };
};

export const createTrustedRootRegistry = (options?: {
	roots?: ConfiguredRoot[];
	builtinLocal?: boolean;
}): TrustedRootRegistry => {
	const configuredRoots = [...(options?.roots ?? [])];
	const builtinRootIds = new Set<string>();

	if (options?.builtinLocal) {
		const rootPaths: string[] = [];

		if (process.platform === "win32") {
			for (const driveLetter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
				const rootPath = `${driveLetter}:\\`;

				if (fs.existsSync(rootPath)) {
					rootPaths.push(rootPath);
				}
			}
		} else {
			rootPaths.push(path.parse(process.cwd()).root);
		}

		// The built-in agent runs this server's own jobs, whose repositories may live anywhere on the server.
		const builtinRoots = rootPaths.map((rootPath) => ({
			id: getLocalFilesystemRootId(rootPath),
			label: process.platform === "win32" ? `Local filesystem (${rootPath.slice(0, 2)})` : "Local filesystem",
			path: rootPath,
			allowBackup: true,
			allowRepository: true,
		}));

		for (const root of builtinRoots) builtinRootIds.add(root.id);
		configuredRoots.unshift(...builtinRoots);
	}

	if (configuredRoots.length > MAX_AGENT_TRUSTED_ROOTS) {
		throw new Error(`The agent may expose at most ${MAX_AGENT_TRUSTED_ROOTS} roots, including its built-in root`);
	}

	assertUniqueRootFields(configuredRoots);

	const entries = configuredRoots.flatMap((root) => {
		try {
			const trustedRoot = canonicalizeRoot(root);

			return [[root.id, trustedRoot] as const];
		} catch (error) {
			if (process.platform === "win32" && builtinRootIds.has(root.id)) return [];
			throw error;
		}
	});

	return new Map(entries);
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

export const resolveFilesystemSource = async (
	registry: TrustedRootRegistry,
	referenceInput: FilesystemSource,
	purpose: Extract<TrustedRootPurpose, "backup" | "browse"> = "backup",
) => {
	const reference = filesystemSourceSchema.parse(referenceInput);
	const root = registry.get(reference.rootId);

	if (!root) {
		throw new Error(`Unknown trusted root "${reference.rootId}"`);
	}

	if (!trustedRootAllows(root.descriptor, purpose)) {
		throw new Error(
			purpose === "backup"
				? `Trusted root "${reference.rootId}" does not allow backups`
				: `Trusted root "${reference.rootId}" does not allow backups or repositories`,
		);
	}

	const relativePath = normalizeTrustedRelativePath(reference.relativePath);
	const unresolvedPath = path.resolve(root.canonicalPath, relativePath);

	if (!isInsideRoot(root.canonicalPath, unresolvedPath)) {
		throw new Error("Trusted source path escapes its configured root");
	}

	let canonicalPath: string;

	try {
		canonicalPath = await realpath(unresolvedPath);
	} catch (error) {
		throw new Error(reportSourceError(error, "Trusted source path cannot be resolved"));
	}

	if (!isInsideRoot(root.canonicalPath, canonicalPath)) {
		throw new Error("Trusted source path escapes its configured root through a symlink");
	}

	return {
		canonicalPath,
		containmentRootPath: root.canonicalPath,
	};
};

const outsideTrustedRootsMessage =
	"Path must be absolute and inside one of this machine's trusted roots (ZEROBYTE_AGENT_ROOTS)";
const outsideRepositoryRootsMessage =
	'Repositories must be inside a trusted root that allows them ("allowRepository": true in ZEROBYTE_AGENT_ROOTS)';

/**
 * Canonicalizes a path that may not exist yet by resolving its nearest existing ancestor with the OS's own
 * semantics (symlinks, then "..") and appending the missing tail. A dangling symlink also makes realpath report
 * ENOENT, but a later write would follow it, so the tail must consist of entries that do not exist at all. Then only
 * a "..", which would be resolved lexically, could make the result differ from what the OS creates later.
 */
export const resolveCanonicalPath = async (absolutePath: string) => {
	const missingSegments: string[] = [];
	let candidate = absolutePath;

	for (;;) {
		let existingPath: string;

		try {
			existingPath = await realpath(candidate);
		} catch (error) {
			const parent = path.dirname(candidate);
			const isMissing = error instanceof Error && "code" in error && error.code === "ENOENT";

			if (!isMissing || parent === candidate) {
				throw error;
			}

			const isDanglingLink = await lstat(candidate).then(
				() => true,
				() => false,
			);
			if (isDanglingLink) {
				throw new Error(outsideTrustedRootsMessage);
			}

			missingSegments.unshift(path.basename(candidate));
			candidate = parent;
			continue;
		}

		if (missingSegments.includes("..")) {
			throw new Error(outsideTrustedRootsMessage);
		}

		return path.join(existingPath, ...missingSegments);
	}
};

/**
 * Rejects paths that are not inside one of this agent's trusted roots (only roots allowing `purpose`, when given),
 * including paths that reach a root through a symlink. The path does not need to exist yet, which is required for
 * repositories before init. Returns the canonical path that was checked.
 */
export const assertPathWithinTrustedRoots = async (
	registry: TrustedRootRegistry,
	absolutePath: string,
	purpose?: TrustedRootPurpose,
) => {
	const message = purpose === "repository" ? outsideRepositoryRootsMessage : outsideTrustedRootsMessage;

	if (!path.isAbsolute(absolutePath)) {
		throw new Error(message);
	}

	const canonicalPath = await resolveCanonicalPath(absolutePath);

	for (const root of registry.values()) {
		if (
			(!purpose || trustedRootAllows(root.descriptor, purpose)) &&
			isInsideRoot(root.canonicalPath, canonicalPath)
		) {
			return canonicalPath;
		}
	}

	throw new Error(message);
};

/**
 * Returns the config restic must run with on this machine. A local repository either names a trusted root and a path
 * relative to it (repositories the controller placed on this agent) or carries an absolute path (the built-in agent
 * running this server's own repositories); either way it must stay inside a root that allows repositories.
 */
export const resolveRepositoryConfig = async (
	registry: TrustedRootRegistry,
	config: RepositoryConfig,
): Promise<RepositoryConfig> => {
	if (config.backend !== "local") {
		return config;
	}

	const { trustedRootId, ...localConfig } = config;

	if (trustedRootId === undefined) {
		await assertPathWithinTrustedRoots(registry, config.path, "repository");
		return localConfig;
	}

	const root = registry.get(trustedRootId);

	if (!root) {
		throw new Error(`Unknown trusted root "${trustedRootId}"`);
	}

	if (!trustedRootAllows(root.descriptor, "repository")) {
		throw new Error(`Trusted root "${trustedRootId}" does not allow repositories`);
	}

	const relativePath = normalizeTrustedRelativePath(config.path);
	const canonicalPath = await resolveCanonicalPath(path.resolve(root.canonicalPath, relativePath));

	if (!isInsideRoot(root.canonicalPath, canonicalPath)) {
		throw new Error("Repository path escapes its trusted root");
	}

	return { ...localConfig, path: canonicalPath };
};
