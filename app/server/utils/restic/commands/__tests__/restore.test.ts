import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as spawnModule from "~/server/utils/spawn";
import { restore } from "../restore";

const successfulRestoreSummary = JSON.stringify({
	message_type: "summary",
	files_restored: 1,
	files_skipped: 0,
	bytes_skipped: 0,
});

const config = {
	backend: "local" as const,
	path: "/tmp/restic-repo",
	isExistingRepository: true,
	customPassword: "custom-password",
};

/**
 * Sets up the safeSpawn mock and returns helpers to inspect the restic args
 * that were built for the restore command.
 */
const setup = () => {
	let capturedArgs: string[] = [];

	spyOn(spawnModule, "safeSpawn").mockImplementation((params) => {
		capturedArgs = params.args;
		return Promise.resolve({ exitCode: 0, summary: successfulRestoreSummary, error: "" });
	});

	const getRestoreArg = () => {
		const restoreIndex = capturedArgs.indexOf("restore");
		if (restoreIndex < 0 || !capturedArgs[restoreIndex + 1]) {
			throw new Error("Expected restore argument after restore command");
		}
		return capturedArgs[restoreIndex + 1]!;
	};

	const getOptionValues = (option: string): string[] => {
		const values: string[] = [];
		for (let i = 0; i < capturedArgs.length - 1; i++) {
			if (capturedArgs[i] === option && capturedArgs[i + 1]) {
				values.push(capturedArgs[i + 1]!);
			}
		}
		return values;
	};

	return {
		getArgs: () => capturedArgs,
		getRestoreArg,
		getOptionValues,
	};
};

afterEach(() => {
	mock.restore();
});

describe("restore command", () => {
	test("keeps snapshot restore arg and absolute include paths when target is root", async () => {
		const { getRestoreArg, getOptionValues } = setup();
		await restore(config, "snapshot-123", "/", {
			organizationId: "org-1",
			include: [
				"/var/lib/zerobyte/volumes/vol123/_data/Documents/report.pdf",
				"/var/lib/zerobyte/volumes/vol123/_data/Photos/summer.jpg",
			],
		});

		expect(getRestoreArg()).toBe("snapshot-123");
		expect(getOptionValues("--include")).toEqual([
			"/var/lib/zerobyte/volumes/vol123/_data/Documents/report.pdf",
			"/var/lib/zerobyte/volumes/vol123/_data/Photos/summer.jpg",
		]);
	});

	test("restores from common ancestor and strips include paths for non-root targets", async () => {
		const { getRestoreArg, getOptionValues } = setup();
		await restore(config, "snapshot-456", "/tmp/restore-target", {
			organizationId: "org-1",
			include: [
				"/var/lib/zerobyte/volumes/vol123/_data/Documents/report.pdf",
				"/var/lib/zerobyte/volumes/vol123/_data/Photos/summer.jpg",
			],
		});

		expect(getRestoreArg()).toBe("snapshot-456:/var/lib/zerobyte/volumes/vol123/_data");
		expect(getOptionValues("--include")).toEqual(["Documents/report.pdf", "Photos/summer.jpg"]);
	});

	test("uses base path for non-root restore when includes are omitted", async () => {
		const { getRestoreArg, getOptionValues } = setup();
		await restore(config, "snapshot-789", "/tmp/restore-target", {
			organizationId: "org-1",
			basePath: "/var/lib/zerobyte/volumes/vol123/_data",
		});

		expect(getRestoreArg()).toBe("snapshot-789:/var/lib/zerobyte/volumes/vol123/_data");
		expect(getOptionValues("--include")).toEqual([]);
	});

	test("does not pass an empty include when include equals restore root", async () => {
		const { getArgs, getRestoreArg, getOptionValues } = setup();
		await restore(config, "snapshot-7202d8cc", "/Users/nicolas/Documents/restore", {
			organizationId: "org-1",
			include: ["/Users/nicolas/Developer/zerobyte/tmp/deep/test/files"],
			overwrite: "always",
		});

		expect(getRestoreArg()).toBe("snapshot-7202d8cc:/Users/nicolas/Developer/zerobyte/tmp/deep/test/files");
		expect(getOptionValues("--include")).toEqual([]);
		expect(getArgs()).not.toContain("");
	});
});
