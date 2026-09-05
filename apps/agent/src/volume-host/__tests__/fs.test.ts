import { expect, test } from "vitest";
import { parseMountOutput, parseProcMountInfo } from "../fs";

test("parses Linux mountinfo mount points and filesystem types", () => {
	const mounts = parseProcMountInfo("36 25 0:32 / /Volumes/My\\040Disk rw - fuse.sshfs host:/ rw");

	expect(mounts).toEqual([{ mountPoint: "/Volumes/My Disk", fstype: "fuse.sshfs" }]);
});

test("parses portable mount output used when procfs is unavailable", () => {
	const mounts = parseMountOutput(
		"/dev/disk3s1s1 on / (apfs, sealed, local, read-only)\nhost:/data on /Volumes/My\\040Disk (macfuse, nodev)",
	);

	expect(mounts).toEqual([
		{ mountPoint: "/", fstype: "apfs" },
		{ mountPoint: "/Volumes/My Disk", fstype: "macfuse" },
	]);
});

test("rejects non-empty mount output when no lines can be parsed", () => {
	expect(() => parseMountOutput("unexpected mount output")).toThrow("Failed to parse non-empty mount command output");
});

test("rejects non-empty proc mount info when no lines can be parsed", () => {
	expect(() => parseProcMountInfo("unexpected mount info")).toThrow("Failed to parse non-empty /proc/self/mountinfo");
});
