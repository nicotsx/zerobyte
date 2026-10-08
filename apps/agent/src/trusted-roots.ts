import * as fs from "node:fs";
import { realpath } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { reportSourceError } from "./filesystem-paths";
import { z } from "zod";
import { MAX_AGENT_TRUSTED_ROOTS } from "@zerobyte/contracts/agent-protocol";
import {
	getLocalFilesystemRootId,
	trustedRootDescriptorSchema,
	filesystemSourceSchema,
	normalizeTrustedSourceRelativePath,
	type TrustedRootDescriptor,
	type FilesystemSource,
} from "@zerobyte/contracts/volumes";

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

	return { descriptor, canonicalPath };
};

export const createTrustedRootRegistry = (options?: {
	rawRoots?: string;
	builtinLocal?: boolean;
}): TrustedRootRegistry => {
	const configuredRoots = options?.rawRoots === undefined ? [] : parseConfiguredRoots(options.rawRoots);
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

		const builtinRoots = rootPaths.map((rootPath) => ({
			id: getLocalFilesystemRootId(rootPath),
			label: process.platform === "win32" ? `Local filesystem (${rootPath.slice(0, 2)})` : "Local filesystem",
			path: rootPath,
			allowBackup: true,
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

export const resolveFilesystemSource = async (registry: TrustedRootRegistry, referenceInput: FilesystemSource) => {
	const reference = filesystemSourceSchema.parse(referenceInput);
	const root = registry.get(reference.rootId);

	if (!root) {
		throw new Error(`Unknown trusted root "${reference.rootId}"`);
	}

	if (!root.descriptor.canBackup) {
		throw new Error(`Trusted root "${reference.rootId}" does not allow backups`);
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
