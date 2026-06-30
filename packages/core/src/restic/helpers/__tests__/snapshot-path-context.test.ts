import { describe, expect, test } from "vitest";
import { createSnapshotPathContext, SnapshotRestorePlanningError } from "../snapshot-path-context";

describe("createSnapshotPathContext", () => {
	test("plans POSIX browsing and display conversion paths", () => {
		const context = createSnapshotPathContext({
			snapshotPaths: ["/mnt/project/docs", "/mnt/project/photos"],
			targetPlatform: "linux",
			displayBasePath: "/mnt",
		});

		expect(context.source).toMatchObject({
			sourcePathKind: "posix",
			queryBasePath: "/mnt/project",
			requiresCustomTarget: false,
			canRestoreOriginal: true,
		});
		expect(context.browser.initialQueryPath()).toBe("/mnt/project");
		expect(context.browser.isDisplayBaseCompatible()).toBe(true);
		expect(context.browser.toDisplayPath("/mnt/project/docs")).toBe("/project/docs");
		expect(context.browser.toSnapshotPath("/project/photos")).toBe("/mnt/project/photos");
	});

	test("plans POSIX restore paths", () => {
		const context = createSnapshotPathContext({
			snapshotPaths: ["/mnt/project/docs", "/mnt/project/photos"],
			targetPlatform: "linux",
			displayBasePath: "/mnt",
		});

		expect(
			context.restore.plan({
				location: { kind: "custom", targetPath: "/restore-target" },
				include: ["/mnt/project/docs/report.txt"],
				selectedItemKind: "file",
			}),
		).toMatchObject({
			target: "/restore-target",
			options: {
				basePath: "/mnt/project",
				sourcePathKind: "posix",
				include: ["/mnt/project/docs/report.txt"],
				selectedItemKind: "file",
			},
		});
	});

	test("keeps POSIX restore selections and exclude patterns literal", () => {
		const context = createSnapshotPathContext({
			snapshotPaths: ["/tmp/foo%2Fbar.txt"],
			targetPlatform: "linux",
		});

		expect(
			context.restore.plan({
				location: { kind: "custom", targetPath: "/restore-target" },
				include: ["/tmp/foo%2Fbar.txt"],
				selectedItemKind: "file",
				exclude: ["*.tmp"],
			}),
		).toMatchObject({
			target: "/restore-target",
			options: {
				basePath: "/tmp/foo%2Fbar.txt",
				sourcePathKind: "posix",
				include: ["/tmp/foo%2Fbar.txt"],
				selectedItemKind: "file",
				exclude: ["*.tmp"],
			},
		});
	});

	test("plans POSIX dump paths", () => {
		const context = createSnapshotPathContext({
			snapshotPaths: ["/mnt/project/docs", "/mnt/project/photos"],
			targetPlatform: "linux",
			displayBasePath: "/mnt",
		});

		expect(context.dump.plan({ snapshotId: "snap-1", requestedPath: "/mnt/project/docs" })).toEqual({
			snapshotRef: "snap-1:/mnt/project",
			path: "/docs",
		});
	});

	test("keeps restic drive-looking paths as POSIX source paths on POSIX targets", () => {
		const context = createSnapshotPathContext({
			snapshotPaths: ["/C/projects/App", "/C/projects/app/data"],
			targetPlatform: "linux",
		});

		expect(context.source).toMatchObject({
			sourcePathKind: "posix",
			queryBasePath: "/C/projects",
			requiresCustomTarget: false,
			canRestoreOriginal: true,
		});
		expect(context.restore.plan({ location: { kind: "original" } })).toMatchObject({
			target: "/",
			options: {
				basePath: "/C/projects",
				sourcePathKind: "posix",
			},
		});
	});

	test("keeps ambiguous lowercase drive-looking paths as POSIX source paths on Windows targets", () => {
		const context = createSnapshotPathContext({
			snapshotPaths: ["/a/foo", "/a/Foo/bar"],
			targetPlatform: "win32",
		});

		expect(context.source).toMatchObject({
			sourcePathKind: "posix",
			queryBasePath: "/a",
			requiresCustomTarget: false,
			canRestoreOriginal: true,
		});
	});

	test("handles Windows host paths with case-insensitive display roots on Windows targets", () => {
		const context = createSnapshotPathContext({
			snapshotPaths: ["C:\\Users\\foo\\Photos", "c:/Users/foo/Documents"],
			targetPlatform: "win32",
			displayBasePath: "C:\\Users\\Foo",
		});

		expect(context.source).toMatchObject({
			sourcePathKind: "windows",
			queryBasePath: "/C/Users/foo",
			requiresCustomTarget: false,
			canRestoreOriginal: true,
		});
		expect(context.browser.isDisplayBaseCompatible()).toBe(true);
		expect(context.browser.toDisplayPath("/C/Users/foo/Photos")).toBe("/Photos");
		expect(context.browser.toSnapshotPath("/Downloads")).toBe("/C/Users/foo/Downloads");
		expect(context.restore.plan({ location: { kind: "original" } })).toMatchObject({
			target: "C:\\Users\\foo",
			options: { basePath: "/C/Users/foo", sourcePathKind: "windows" },
		});
	});

	test("keeps Windows query base when original restore is unavailable on POSIX targets", () => {
		const context = createSnapshotPathContext({
			snapshotPaths: ["C:\\Users\\Nicolas\\Photos", "C:\\Users\\Nicolas\\Documents"],
			targetPlatform: "linux",
		});

		expect(context.source).toMatchObject({
			sourcePathKind: "windows",
			queryBasePath: "/C/Users/Nicolas",
			requiresCustomTarget: true,
			canRestoreOriginal: false,
		});
		expect(context.browser.initialQueryPath()).toBe("/C/Users/Nicolas");
		expect(context.restore.targetPlan()).toEqual({
			queryBasePath: "/C/Users/Nicolas",
			requiresCustomTarget: true,
		});
		expect(context.dump.plan({ snapshotId: "snap-1", requestedPath: "/C/Users/Nicolas/Photos" })).toEqual({
			snapshotRef: "snap-1:/C/Users/Nicolas",
			path: "/Photos",
		});
		expect(() => context.restore.plan({ location: { kind: "original" } })).toThrow(SnapshotRestorePlanningError);
	});

	test("treats restic Windows drive paths as Windows source paths on Windows targets", () => {
		const context = createSnapshotPathContext({
			snapshotPaths: ["/C/Users/foo/Photos", "/C/Users/foo/Documents"],
			targetPlatform: "win32",
		});

		expect(context.source).toMatchObject({
			sourcePathKind: "windows",
			queryBasePath: "/C/Users/foo",
			requiresCustomTarget: false,
		});
		expect(context.restore.plan({ location: { kind: "original" } })).toMatchObject({
			target: "C:\\Users\\foo",
			options: { basePath: "/C/Users/foo", sourcePathKind: "windows" },
		});
	});

	test("treats restic Windows drive paths as Windows source paths with native Windows display roots", () => {
		const context = createSnapshotPathContext({
			snapshotPaths: ["/C/Users/foo/Photos", "/C/Users/foo/Documents"],
			displayBasePath: "C:\\Users\\Foo",
		});

		expect(context.source).toMatchObject({
			sourcePathKind: "windows",
			queryBasePath: "/C/Users/foo",
			requiresCustomTarget: false,
		});
		expect(context.browser.toDisplayPath("/C/Users/foo/Photos")).toBe("/Photos");
	});

	test("keeps selected Windows files in their original folder on Windows targets", () => {
		const context = createSnapshotPathContext({
			snapshotPaths: ["C:\\Users\\Foo\\Downloads"],
			targetPlatform: "win32",
		});

		expect(
			context.restore.plan({
				location: { kind: "original" },
				include: ["/C/Users/Foo/Downloads/DumpStack.log"],
				selectedItemKind: "file",
			}),
		).toMatchObject({
			target: "C:\\Users\\Foo\\Downloads",
			options: {
				basePath: "/C/Users/Foo/Downloads",
				sourcePathKind: "windows",
				include: ["/C/Users/Foo/Downloads/DumpStack.log"],
				selectedItemKind: "file",
			},
		});
	});

	test("requires custom restore targets for Windows paths spanning drives", () => {
		const context = createSnapshotPathContext({
			snapshotPaths: ["C:\\some\\path", "D:\\other\\path"],
			targetPlatform: "win32",
		});

		expect(context.source).toMatchObject({
			sourcePathKind: "windows",
			queryBasePath: "/",
			requiresCustomTarget: true,
			canRestoreOriginal: false,
		});
		expect(() => context.restore.plan({ location: { kind: "original" } })).toThrow(SnapshotRestorePlanningError);
	});

	test("requires custom restore targets when display base does not contain the snapshot base", () => {
		const context = createSnapshotPathContext({
			snapshotPaths: ["/mnt/project"],
			targetPlatform: "linux",
			displayBasePath: "/other/root",
		});

		expect(context.browser.isDisplayBaseCompatible()).toBe(false);
		expect(context.restore.targetPlan()).toEqual({
			queryBasePath: "/mnt/project",
			requiresCustomTarget: true,
		});
		expect(context.browser.toDisplayPath("/mnt/project")).toBe("/mnt/project");
	});

	test("rejects dump paths outside the snapshot base", () => {
		const context = createSnapshotPathContext({
			snapshotPaths: ["/mnt/project/docs"],
			targetPlatform: "linux",
		});

		expect(() => context.dump.plan({ snapshotId: "snap-1", requestedPath: "/other/path" })).toThrow(
			"Requested path is outside the snapshot base path",
		);
	});
});
