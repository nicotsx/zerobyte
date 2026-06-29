import { describe, expect, test } from "vitest";
import { createSnapshotRestoreExecutionPlan, SnapshotRestorePlanningError } from "../snapshot-restore-plan";

describe("snapshot restore planning", () => {
	test("plans a POSIX custom-target restore from the snapshot source base", () => {
		const plan = createSnapshotRestoreExecutionPlan({
			snapshotPaths: ["/var/lib/zerobyte/volumes/vol123/_data"],
			platform: "linux",
			request: { location: { kind: "custom", targetPath: "/restore-target" } },
		});

		expect(plan).toMatchObject({
			target: "/restore-target",
			options: { basePath: "/var/lib/zerobyte/volumes/vol123/_data" },
		});
	});

	test("plans Windows original-location restores on Windows hosts", () => {
		const plan = createSnapshotRestoreExecutionPlan({
			snapshotPaths: ["C:\\Users\\nicolas\\Photos", "C:\\Users\\nicolas\\Documents"],
			platform: "win32",
			request: { location: { kind: "original" } },
		});

		expect(plan).toMatchObject({
			target: "C:\\Users\\nicolas",
			options: { basePath: "/C/Users/nicolas" },
		});
	});

	test("requires custom targets for Windows original-location restores on POSIX hosts", () => {
		expect(() =>
			createSnapshotRestoreExecutionPlan({
				snapshotPaths: ["C:\\Users\\nicolas\\Photos"],
				platform: "linux",
				request: { location: { kind: "original" } },
			}),
		).toThrow(SnapshotRestorePlanningError);
	});
});
