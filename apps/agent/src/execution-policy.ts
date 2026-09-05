import type { AgentCapabilities } from "@zerobyte/contracts/agent-protocol";
import type { VolumeExecutionSource } from "@zerobyte/contracts/volumes";
import type { TrustedRootRegistry } from "./trusted-roots";
import type { ControllerCommandContext } from "./context";
import { getTrustedRootDescriptors, normalizeTrustedRelativePath, resolveTrustedSourcePath } from "./trusted-roots";
import { createTrustedSourcePresentation, type TrustedSourcePresentation } from "./trusted-source-presentation";
import { getVolumePath } from "./volume-host/paths";

export type FilesystemSourceOperation = "backup.run" | "volume.statfs" | "volume.listFiles";
type TrustedSourceOperation = FilesystemSourceOperation | "filesystem.browse";

export type ResolvedFilesystemSource = {
	canonicalPath: string;
	containmentRootPath: string;
	presentation?: TrustedSourcePresentation;
};

type ResolvedTrustedFilesystemSource = ResolvedFilesystemSource & {
	presentation: TrustedSourcePresentation;
};

export type ResolvedFileListingSource = ResolvedFilesystemSource & {
	sourceId: string;
	requestedSubPath?: string;
	responsePathStyle: "legacy" | "source-relative";
};

export type AgentExecutionPolicy = {
	capabilities: AgentCapabilities;
	assertLocalOperation: (operation: string) => void;
	assertUnrestrictedLocalFilesystem: (operation: string) => void;
	resolveExecutionSource: (
		source: VolumeExecutionSource,
		operation: FilesystemSourceOperation,
	) => ResolvedFilesystemSource;
	resolveTrustedReference: (
		reference: Extract<VolumeExecutionSource, { kind: "agent-filesystem" }>["reference"],
		operation: TrustedSourceOperation,
	) => ResolvedTrustedFilesystemSource;
	resolveFileListingSource: (source: VolumeExecutionSource, subPath?: string) => ResolvedFileListingSource;
};

export const createAgentExecutionPolicy = (options: {
	builtinLocal: boolean;
	registry: TrustedRootRegistry;
}): AgentExecutionPolicy => {
	const trustedRoots = getTrustedRootDescriptors(options.registry);
	const hasBackupRoot = trustedRoots.some((root) => root.canBackup);

	const assertLocalOperation = (operation: string) => {
		if (!options.builtinLocal) {
			throw new Error(`${operation} is only available on the supervised built-in local agent`);
		}
	};

	const assertUnrestrictedLocalFilesystem = (operation: string) => {
		if (!options.builtinLocal || !options.registry.hasImplicitBuiltinCompatibilityRoot) {
			throw new Error(`${operation} requires the implicit built-in local filesystem compatibility root`);
		}
	};

	const resolveTrustedReference: AgentExecutionPolicy["resolveTrustedReference"] = (reference) => {
		const resolved = resolveTrustedSourcePath(options.registry, reference);

		const presentation = createTrustedSourcePresentation({
			configuredRootPath: resolved.root.configuredPath,
			canonicalRootPath: resolved.root.canonicalPath,
			sourceRelativePath: resolved.relativePath,
		});

		return {
			canonicalPath: resolved.canonicalPath,
			containmentRootPath: resolved.root.canonicalPath,
			presentation,
		};
	};

	const resolveExecutionSource: AgentExecutionPolicy["resolveExecutionSource"] = (source, operation) => {
		if (source.kind === "agent-filesystem") {
			return resolveTrustedReference(source.reference, operation);
		}

		assertLocalOperation(operation);

		const canonicalPath = getVolumePath(source.volume);

		return {
			canonicalPath,
			containmentRootPath: canonicalPath,
		};
	};

	const resolveFileListingSource: AgentExecutionPolicy["resolveFileListingSource"] = (source, subPath) => {
		const resolved = resolveExecutionSource(source, "volume.listFiles");

		if (source.kind === "managed") {
			return {
				...resolved,
				sourceId: source.volume.shortId,
				requestedSubPath: subPath,
				responsePathStyle: "legacy",
			};
		}

		const relativeSubPath = (subPath ?? "").replace(/^\/+/, "");
		const requestedSubPath = normalizeTrustedRelativePath(relativeSubPath);

		return {
			...resolved,
			sourceId: source.reference.rootId,
			requestedSubPath,
			responsePathStyle: "source-relative",
		};
	};

	const capabilities: AgentCapabilities = {
		backup: options.builtinLocal || hasBackupRoot,
		restore: options.builtinLocal,
		volume: options.builtinLocal,
		restic: true,
		trustedRoots,
	};

	return {
		capabilities,
		assertLocalOperation,
		assertUnrestrictedLocalFilesystem,
		resolveExecutionSource,
		resolveTrustedReference,
		resolveFileListingSource,
	};
};

export const getAgentExecutionPolicy = (context: ControllerCommandContext) => {
	return context.executionPolicy;
};
