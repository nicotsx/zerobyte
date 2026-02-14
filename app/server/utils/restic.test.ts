import { describe, expect, test } from "bun:test";
import { buildRepoUrl } from "./restic";

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
