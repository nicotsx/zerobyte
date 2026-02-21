import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as spawnModule from "./spawn";
import { buildRepoUrl, restic } from "./restic";

const successfulRestoreSummary = JSON.stringify({
	message_type: "summary",
	files_restored: 1,
	files_skipped: 0,
	bytes_skipped: 0,
});

let lastSafeSpawnArgs: string[] = [];

const safeSpawnMock = mock((params: spawnModule.SafeSpawnParams) => {
	lastSafeSpawnArgs = params.args;

	return Promise.resolve({
		exitCode: 0,
		summary: successfulRestoreSummary,
		error: "",
	});
});

const getRestoreArg = (args: string[]): string => {
	const restoreIndex = args.indexOf("restore");
	if (restoreIndex < 0) {
		throw new Error("Expected restore command in restic arguments");
	}

	const restoreArg = args[restoreIndex + 1];
	if (!restoreArg) {
		throw new Error("Expected restore argument after restore command");
	}

	return restoreArg;
};

const getOptionValues = (args: string[], option: string): string[] => {
	const values: string[] = [];
	for (let i = 0; i < args.length - 1; i++) {
		if (args[i] === option) {
			const value = args[i + 1];
			if (value) {
				values.push(value);
			}
		}
	}

	return values;
};

const getLastSafeSpawnArgs = (): string[] => {
	if (lastSafeSpawnArgs.length === 0) {
		throw new Error("Expected safeSpawn to be called");
	}

	return lastSafeSpawnArgs;
};

beforeEach(() => {
	safeSpawnMock.mockClear();
	lastSafeSpawnArgs = [];
	spyOn(spawnModule, "safeSpawn").mockImplementation(safeSpawnMock);
});

afterEach(() => {
	mock.restore();
});

describe("buildRepoUrl", () => {
	describe("S3 backend", () => {
		test("should build URL without trailing slash", () => {
			const config = {
				backend: "s3" as const,
				endpoint: "https://s3.amazonaws.com",
				bucket: "my-bucket",
				accessKeyId: "test",
				secretAccessKey: "test",
			};
			expect(buildRepoUrl(config)).toBe("s3:https://s3.amazonaws.com/my-bucket");
		});

		test("should trim trailing slash from endpoint", () => {
			const config = {
				backend: "s3" as const,
				endpoint: "https://s3.xxxxxxxxx.net/",
				bucket: "backup",
				accessKeyId: "test",
				secretAccessKey: "test",
			};
			expect(buildRepoUrl(config)).toBe("s3:https://s3.xxxxxxxxx.net/backup");
		});

		test("should trim trailing whitespace from endpoint", () => {
			const config = {
				backend: "s3" as const,
				endpoint: "https://s3.amazonaws.com/  ",
				bucket: "my-bucket",
				accessKeyId: "test",
				secretAccessKey: "test",
			};
			expect(buildRepoUrl(config)).toBe("s3:https://s3.amazonaws.com/my-bucket");
		});

		test("should trim leading and trailing whitespace from endpoint", () => {
			const config = {
				backend: "s3" as const,
				endpoint: "  https://s3.amazonaws.com/  ",
				bucket: "my-bucket",
				accessKeyId: "test",
				secretAccessKey: "test",
			};
			expect(buildRepoUrl(config)).toBe("s3:https://s3.amazonaws.com/my-bucket");
		});
	});

	describe("R2 backend", () => {
		test("should build URL without trailing slash", () => {
			const config = {
				backend: "r2" as const,
				endpoint: "https://myaccount.r2.cloudflarestorage.com",
				bucket: "my-bucket",
				accessKeyId: "test",
				secretAccessKey: "test",
			};
			expect(buildRepoUrl(config)).toBe("s3:myaccount.r2.cloudflarestorage.com/my-bucket");
		});

		test("should trim trailing slash from endpoint", () => {
			const config = {
				backend: "r2" as const,
				endpoint: "https://myaccount.r2.cloudflarestorage.com/",
				bucket: "backup",
				accessKeyId: "test",
				secretAccessKey: "test",
			};
			expect(buildRepoUrl(config)).toBe("s3:myaccount.r2.cloudflarestorage.com/backup");
		});

		test("should strip protocol and trailing slash", () => {
			const config = {
				backend: "r2" as const,
				endpoint: "https://myaccount.r2.cloudflarestorage.com/",
				bucket: "my-bucket",
				accessKeyId: "test",
				secretAccessKey: "test",
			};
			expect(buildRepoUrl(config)).toBe("s3:myaccount.r2.cloudflarestorage.com/my-bucket");
		});

		test("should trim whitespace and strip protocol", () => {
			const config = {
				backend: "r2" as const,
				endpoint: "  https://myaccount.r2.cloudflarestorage.com/  ",
				bucket: "my-bucket",
				accessKeyId: "test",
				secretAccessKey: "test",
			};
			expect(buildRepoUrl(config)).toBe("s3:myaccount.r2.cloudflarestorage.com/my-bucket");
		});
	});

	describe("other backends", () => {
		test("should build local repository URL", () => {
			const config = {
				backend: "local" as const,
				path: "/path/to/repo",
			};
			expect(buildRepoUrl(config)).toBe("/path/to/repo");
		});
	});
});

describe("restore", () => {
	const config = {
		backend: "local" as const,
		path: "/tmp/restic-repo",
		isExistingRepository: true,
		customPassword: "custom-password",
	};

	test("keeps snapshot restore arg and absolute include paths when target is root", async () => {
		await restic.restore(config, "snapshot-123", "/", {
			organizationId: "org-1",
			include: [
				"/var/lib/zerobyte/volumes/vol123/_data/Documents/report.pdf",
				"/var/lib/zerobyte/volumes/vol123/_data/Photos/summer.jpg",
			],
		});

		const args = getLastSafeSpawnArgs();
		expect(getRestoreArg(args)).toBe("snapshot-123");
		expect(getOptionValues(args, "--include")).toEqual([
			"/var/lib/zerobyte/volumes/vol123/_data/Documents/report.pdf",
			"/var/lib/zerobyte/volumes/vol123/_data/Photos/summer.jpg",
		]);
	});

	test("restores from common ancestor and strips include paths for non-root targets", async () => {
		await restic.restore(config, "snapshot-456", "/tmp/restore-target", {
			organizationId: "org-1",
			include: [
				"/var/lib/zerobyte/volumes/vol123/_data/Documents/report.pdf",
				"/var/lib/zerobyte/volumes/vol123/_data/Photos/summer.jpg",
			],
		});

		const args = getLastSafeSpawnArgs();
		expect(getRestoreArg(args)).toBe("snapshot-456:/var/lib/zerobyte/volumes/vol123/_data");
		expect(getOptionValues(args, "--include")).toEqual(["Documents/report.pdf", "Photos/summer.jpg"]);
	});

	test("uses base path for non-root restore when includes are omitted", async () => {
		await restic.restore(config, "snapshot-789", "/tmp/restore-target", {
			organizationId: "org-1",
			basePath: "/var/lib/zerobyte/volumes/vol123/_data",
		});

		const args = getLastSafeSpawnArgs();
		expect(getRestoreArg(args)).toBe("snapshot-789:/var/lib/zerobyte/volumes/vol123/_data");
		expect(getOptionValues(args, "--include")).toEqual([]);
	});

	test("does not pass an empty include when include equals restore root", async () => {
		await restic.restore(config, "snapshot-7202d8cc", "/Users/nicolas/Documents/restore", {
			organizationId: "org-1",
			include: ["/Users/nicolas/Developer/zerobyte/tmp/deep/test/files"],
			overwrite: "always",
		});

		const args = getLastSafeSpawnArgs();
		expect(getRestoreArg(args)).toBe("snapshot-7202d8cc:/Users/nicolas/Developer/zerobyte/tmp/deep/test/files");
		expect(getOptionValues(args, "--include")).toEqual([]);
		expect(args).not.toContain("");
	});
});
