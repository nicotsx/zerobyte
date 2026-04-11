import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@zerobyte/core/node", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@zerobyte/core/node")>();

	return {
		...actual,
		safeExec: vi.fn(),
	};
});

import { safeExec } from "@zerobyte/core/node";
import { RCLONE_CONFIG_FILE } from "../../core/constants";
import { getRcloneRemoteInfo, listRcloneRemotes } from "../rclone";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("rclone utilities", () => {
	test("lists remotes using the configured rclone config file", async () => {
		vi.mocked(safeExec).mockResolvedValueOnce({
			exitCode: 0,
			stdout: "primary:\narchive:\n",
			stderr: "",
			timedOut: false,
		});

		expect(await listRcloneRemotes()).toEqual(["primary", "archive"]);
		expect(safeExec).toHaveBeenCalledWith({
			command: "rclone",
			args: ["listremotes"],
			env: { RCLONE_CONFIG: RCLONE_CONFIG_FILE },
		});
	});

	test("loads remote details using the configured rclone config file", async () => {
		vi.mocked(safeExec).mockResolvedValueOnce({
			exitCode: 0,
			stdout: "[primary]\ntype = s3\nprovider = AWS\n",
			stderr: "",
			timedOut: false,
		});

		expect(await getRcloneRemoteInfo("primary")).toEqual({
			type: "s3",
			config: {
				type: "s3",
				provider: "AWS",
			},
		});
		expect(safeExec).toHaveBeenCalledWith({
			command: "rclone",
			args: ["config", "show", "primary"],
			env: { RCLONE_CONFIG: RCLONE_CONFIG_FILE },
		});
	});
});
