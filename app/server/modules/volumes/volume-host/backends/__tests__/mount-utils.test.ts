import { afterEach, expect, test, vi } from "vitest";
import * as node from "@zerobyte/core/node";
import { executeDavfsMount } from "../utils";

afterEach(() => vi.restoreAllMocks());

test("invokes mount.davfs directly and supplies only the password through stdin", async () => {
	const safeExec = vi.spyOn(node, "safeExec").mockResolvedValue({
		exitCode: 0,
		stdout: "",
		stderr: "",
		timedOut: false,
	});

	await executeDavfsMount(
		["-o", "username=archive-user,ro", "https://dav.example/archive", "/mnt/archive"],
		"private password",
	);

	expect(safeExec).toHaveBeenCalledWith(
		expect.objectContaining({
			command: "mount.davfs",
			input: "private password\n",
			timeout: 10_000,
		}),
	);
	expect(safeExec.mock.calls[0]?.[0].args).not.toContain("private password");
	expect(safeExec.mock.calls[0]?.[0].args).not.toContain("-v");
});
