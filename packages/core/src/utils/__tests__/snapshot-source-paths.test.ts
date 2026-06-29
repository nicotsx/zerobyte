import { describe, expect, test } from "vitest";
import { getOriginalRestoreTargetForRoot, getSnapshotSourcePathPlan } from "../snapshot-source-paths";

describe("getSnapshotSourcePathPlan", () => {
	test("keeps POSIX snapshots restorable to original by default", () => {
		expect(
			getSnapshotSourcePathPlan({
				snapshotPaths: ["/mnt/source/photos", "/mnt/source/docs"],
			}),
		).toMatchObject({
			sourcePathKind: "posix",
			queryBasePath: "/mnt/source",
			originalRestoreBasePath: "/mnt/source",
			customRestoreBasePath: "/mnt/source",
			requiresCustomTarget: false,
		});
	});

	test("keeps Windows snapshots on custom-target restore for POSIX hosts", () => {
		expect(
			getSnapshotSourcePathPlan({
				snapshotPaths: ["C:\\Users\\nicolas\\Photos"],
			}),
		).toMatchObject({
			sourcePathKind: "windows",
			queryBasePath: "/",
			originalRestoreBasePath: "/",
			customRestoreBasePath: "/",
			requiresCustomTarget: true,
		});
	});

	test("keeps Windows snapshots restorable to original on Windows hosts", () => {
		expect(
			getSnapshotSourcePathPlan({
				snapshotPaths: ["C:\\Users\\nicolas\\Photos", "c:/Users/nicolas/Documents"],
				hostPathKind: "windows",
			}),
		).toMatchObject({
			sourcePathKind: "windows",
			queryBasePath: "/C/Users/nicolas",
			originalRestoreBasePath: "/C/Users/nicolas",
			customRestoreBasePath: "/",
			requiresCustomTarget: false,
		});
	});

	test("targets the selected Windows restore root itself for original-location restores", () => {
		expect(
			getOriginalRestoreTargetForRoot({
				restoreRoot: "/C/Users/Nicolas/Downloads",
				sourcePathKind: "windows",
			}),
		).toBe("C:\\Users\\Nicolas\\Downloads");
	});

	test("requires custom target for unsupported native paths", () => {
		expect(
			getSnapshotSourcePathPlan({
				snapshotPaths: ["relative\\path"],
			}),
		).toMatchObject({
			sourcePathKind: "unsupported",
			queryBasePath: "/",
			originalRestoreBasePath: "/",
			customRestoreBasePath: "/",
			requiresCustomTarget: true,
		});
	});

	test("requires custom target for mixed POSIX and Windows paths", () => {
		expect(
			getSnapshotSourcePathPlan({
				snapshotPaths: ["C:\\some\\path", "/mnt/source"],
			}),
		).toMatchObject({
			sourcePathKind: "unsupported",
			queryBasePath: "/",
			originalRestoreBasePath: "/",
			customRestoreBasePath: "/",
			requiresCustomTarget: true,
		});
	});

	test("requires custom target for Windows paths spanning drives", () => {
		expect(
			getSnapshotSourcePathPlan({
				snapshotPaths: ["C:\\some\\path", "D:\\other\\path"],
				hostPathKind: "windows",
			}),
		).toMatchObject({
			queryBasePath: "/",
			originalRestoreBasePath: "/",
			customRestoreBasePath: "/",
			requiresCustomTarget: true,
		});
	});
});
