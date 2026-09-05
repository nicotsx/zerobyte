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

test("parses Linux mount output when procfs is unavailable", () => {
	const mounts = parseMountOutput(
		"/dev/sda1 on / type ext4 (rw,relatime)\nhost:/data on /mnt/My\\040Disk type fuse.sshfs (rw,nodev)",
	);

	expect(mounts).toEqual([
		{ mountPoint: "/", fstype: "ext4" },
		{ mountPoint: "/mnt/My Disk", fstype: "fuse.sshfs" },
	]);
});

test("ignores blank mount output lines", () => {
	expect(parseMountOutput("\n \t\n/dev/sda1 on / type ext4 (rw)\n\n")).toEqual([{ mountPoint: "/", fstype: "ext4" }]);
	expect(parseMountOutput("\n \t\n")).toEqual([]);
});

test.each(["unexpected mount output", "/dev/sda1 on / type ext4 (rw", "/dev/disk1 on / (apfs, local"])(
	"rejects a partial mount list containing an invalid line: %s",
	(invalidLine) => {
		expect(() => parseMountOutput(`/dev/disk1 on / (apfs, local)\n${invalidLine}`)).toThrow(
			"Failed to parse non-empty mount command output",
		);
	},
);

test("rejects non-empty proc mount info when no lines can be parsed", () => {
	expect(() => parseProcMountInfo("unexpected mount info")).toThrow("Failed to parse non-empty /proc/self/mountinfo");
});

test("rejects a partial Linux mount list instead of deleting potentially mounted directories", () => {
	expect(() => parseProcMountInfo("36 25 0:32 / /mnt/data rw - nfs host:/ rw\nmalformed mount")).toThrow(
		"Failed to parse non-empty /proc/self/mountinfo",
	);
});
