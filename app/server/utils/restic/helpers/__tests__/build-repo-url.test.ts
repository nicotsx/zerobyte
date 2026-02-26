import { describe, expect, test } from "bun:test";
import { buildRepoUrl } from "../build-repo-url";

describe("buildRepoUrl", () => {
	describe("S3 backend", () => {
		test.each([
			{
				label: "standard endpoint",
				endpoint: "https://s3.amazonaws.com",
				bucket: "my-bucket",
				expected: "s3:https://s3.amazonaws.com/my-bucket",
			},
			{
				label: "trailing slash on endpoint",
				endpoint: "https://s3.xxxxxxxxx.net/",
				bucket: "backup",
				expected: "s3:https://s3.xxxxxxxxx.net/backup",
			},
			{
				label: "trailing whitespace on endpoint",
				endpoint: "https://s3.amazonaws.com/  ",
				bucket: "my-bucket",
				expected: "s3:https://s3.amazonaws.com/my-bucket",
			},
			{
				label: "leading and trailing whitespace on endpoint",
				endpoint: "  https://s3.amazonaws.com/  ",
				bucket: "my-bucket",
				expected: "s3:https://s3.amazonaws.com/my-bucket",
			},
		])("$label → $expected", ({ endpoint, bucket, expected }) => {
			expect(buildRepoUrl({ backend: "s3", endpoint, bucket, accessKeyId: "test", secretAccessKey: "test" })).toBe(
				expected,
			);
		});
	});

	describe("R2 backend", () => {
		test.each([
			{
				label: "standard endpoint (strips https:// protocol)",
				endpoint: "https://myaccount.r2.cloudflarestorage.com",
				bucket: "my-bucket",
				expected: "s3:myaccount.r2.cloudflarestorage.com/my-bucket",
			},
			{
				label: "trailing slash on endpoint",
				endpoint: "https://myaccount.r2.cloudflarestorage.com/",
				bucket: "backup",
				expected: "s3:myaccount.r2.cloudflarestorage.com/backup",
			},
			{
				label: "leading and trailing whitespace on endpoint",
				endpoint: "  https://myaccount.r2.cloudflarestorage.com/  ",
				bucket: "my-bucket",
				expected: "s3:myaccount.r2.cloudflarestorage.com/my-bucket",
			},
		])("$label → $expected", ({ endpoint, bucket, expected }) => {
			expect(buildRepoUrl({ backend: "r2", endpoint, bucket, accessKeyId: "test", secretAccessKey: "test" })).toBe(
				expected,
			);
		});
	});

	describe("other backends", () => {
		test("builds local repository URL", () => {
			expect(buildRepoUrl({ backend: "local", path: "/path/to/repo" })).toBe("/path/to/repo");
		});
	});
});
