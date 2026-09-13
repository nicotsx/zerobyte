import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen, within } from "~/test/test-utils";
import type { FileEntry } from "~/client/components/file-tree-model";
import { SnapshotEntryDetails } from "../snapshot-entry-details";

const createEntry = (mode?: number): FileEntry => ({
	name: "entry",
	path: "/entry",
	type: "file",
	size: 0,
	modifiedAt: 0,
	...(mode === undefined ? {} : { mode }),
});

afterEach(() => {
	cleanup();
});

test.each([
	["normal permissions", 0o640, "0640"],
	["zero permissions", 0, "0000"],
	["setuid permissions", (1 << 23) | 0o755, "4755"],
	["setgid permissions", (1 << 22) | 0o755, "2755"],
	["sticky permissions", (1 << 20) | 0o777, "1777"],
	["setuid, setgid, and sticky permissions", (1 << 23) | (1 << 22) | (1 << 20) | 0o755, "7755"],
	["directory mode flag", 2 ** 31 + 0o750, "0750"],
])("shows %s from a Restic Go file mode", (_description, mode, expectedPermissions) => {
	render(<SnapshotEntryDetails entry={createEntry(mode)} />);

	const details = screen.getByRole("region", { name: "Selected entry details" });
	expect(within(details).getByText(expectedPermissions)).toBeTruthy();
});

test("shows a dash when Restic did not provide a mode", () => {
	render(<SnapshotEntryDetails entry={createEntry()} />);

	const details = screen.getByRole("region", { name: "Selected entry details" });
	expect(within(details).getByText("-")).toBeTruthy();
});
