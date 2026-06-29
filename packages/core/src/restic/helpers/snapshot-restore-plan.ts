import {
	getOriginalRestoreTargetForRoot,
	getSnapshotSourcePathPlan,
	hostPathKindFromPlatform,
	type SnapshotSourcePathPlan,
} from "../../utils";
import type { OverwriteMode } from "../schemas";
import { getResticRestoreRoot } from "./restore-paths";

export type SnapshotRestoreLocation = { kind: "original" } | { kind: "custom"; targetPath: string };

export type SnapshotRestoreRequest = {
	location: SnapshotRestoreLocation;
	include?: string[];
	selectedItemKind?: "file" | "dir";
	exclude?: string[];
	excludeXattr?: string[];
	delete?: boolean;
	overwrite?: OverwriteMode;
};

export type SnapshotRestoreExecutionPlan = {
	target: string;
	options: {
		basePath: string;
		include?: string[];
		selectedItemKind?: "file" | "dir";
		exclude?: string[];
		excludeXattr?: string[];
		delete?: boolean;
		overwrite?: OverwriteMode;
	};
	sourcePathPlan: SnapshotSourcePathPlan;
};

export type SnapshotRestoreTargetPlan = Pick<SnapshotSourcePathPlan, "queryBasePath" | "requiresCustomTarget">;

export class SnapshotRestorePlanningError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SnapshotRestorePlanningError";
	}
}

export const isSnapshotRestorePlanningError = (error: unknown): error is SnapshotRestorePlanningError => {
	return error instanceof SnapshotRestorePlanningError;
};

export const getSnapshotRestoreTargetPlan = ({
	snapshotPaths,
	platform,
}: {
	snapshotPaths: string[];
	platform: string;
}): SnapshotRestoreTargetPlan => {
	const sourcePathPlan = getSnapshotSourcePathPlan({
		snapshotPaths,
		hostPathKind: hostPathKindFromPlatform(platform),
	});

	return {
		queryBasePath: sourcePathPlan.queryBasePath,
		requiresCustomTarget: sourcePathPlan.requiresCustomTarget,
	};
};

export const createSnapshotRestoreExecutionPlan = ({
	snapshotPaths,
	platform,
	request,
}: {
	snapshotPaths: string[];
	platform: string;
	request: SnapshotRestoreRequest;
}): SnapshotRestoreExecutionPlan => {
	const sourcePathPlan = getSnapshotSourcePathPlan({
		snapshotPaths,
		hostPathKind: hostPathKindFromPlatform(platform),
	});
	const location = request.location;
	const isCustomLocation = location.kind === "custom";

	if (location.kind === "custom" && location.targetPath.length === 0) {
		throw new SnapshotRestorePlanningError("Restore target path is required for custom-location restores.");
	}

	if (!isCustomLocation && sourcePathPlan.requiresCustomTarget) {
		throw new SnapshotRestorePlanningError(
			"Original location restore is unavailable for this snapshot. Restore it to a custom location instead.",
		);
	}

	const basePath = isCustomLocation ? sourcePathPlan.customRestoreBasePath : sourcePathPlan.originalRestoreBasePath;
	const restoreIncludes = request.include?.length ? request.include : [basePath];
	const restoreRoot = getResticRestoreRoot(restoreIncludes, request.selectedItemKind);
	const target =
		location.kind === "custom"
			? location.targetPath
			: getOriginalRestoreTargetForRoot({
					restoreRoot,
					sourcePathKind: sourcePathPlan.sourcePathKind,
				});

	return {
		target,
		options: {
			basePath,
			...(request.include ? { include: request.include } : {}),
			...(request.selectedItemKind ? { selectedItemKind: request.selectedItemKind } : {}),
			...(request.exclude ? { exclude: request.exclude } : {}),
			...(request.excludeXattr ? { excludeXattr: request.excludeXattr } : {}),
			...(request.delete !== undefined ? { delete: request.delete } : {}),
			...(request.overwrite ? { overwrite: request.overwrite } : {}),
		},
		sourcePathPlan,
	};
};
