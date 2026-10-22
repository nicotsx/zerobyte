import type { RepositoryConfig } from "@zerobyte/core/restic";
import { fromPartial } from "@total-typescript/shoehorn";
import { expect, test, vi } from "vitest";
import { checkMirrorCompatibility, getIncompatibleMirrorError } from "../backend-compatibility";

vi.unmock("~/server/utils/crypto");

type SftpConfig = Extract<RepositoryConfig, { backend: "sftp" }>;

const sftp = fromPartial<SftpConfig>({
	backend: "sftp",
	host: "source.example.com",
	user: "backup",
	path: "/source",
	privateKey: "private-key\n",
});

test.each<[string, Partial<SftpConfig>, Partial<SftpConfig>]>([
	["key line endings and final newline", { privateKey: "key\r\nbody" }, { privateKey: "key\nbody\n" }],
	["default SSH settings", {}, { port: 22, skipHostKeyCheck: false, allowLegacySshRsa: false, knownHosts: "" }],
	[
		"matching custom SSH settings",
		{ port: 2222, allowLegacySshRsa: true, knownHosts: "hosts" },
		{ port: 2222, allowLegacySshRsa: true, knownHosts: "hosts" },
	],
	[
		"unused known hosts",
		{ skipHostKeyCheck: true, knownHosts: "source hosts" },
		{ skipHostKeyCheck: true, knownHosts: "mirror hosts" },
	],
])("allows equivalent SFTP %s", async (_, source, mirror) => {
	expect(await checkMirrorCompatibility({ ...sftp, ...source }, { ...sftp, ...mirror }, "mirror")).toEqual({
		repositoryId: "mirror",
		compatible: true,
		reason: null,
	});
});

test.each<[string, Partial<SftpConfig>]>([
	["private key", { privateKey: "different-key" }],
	["port", { port: 2222 }],
	["host verification", { skipHostKeyCheck: true }],
	["known hosts", { knownHosts: "custom hosts" }],
	["legacy RSA", { allowLegacySshRsa: true }],
])("rejects differing SFTP %s in either direction with an accurate explanation", async (_, changes) => {
	const mirror = { ...sftp, ...changes };

	for (const [sourceConfig, mirrorConfig] of [
		[sftp, mirror],
		[mirror, sftp],
	]) {
		const result = await checkMirrorCompatibility(sourceConfig, mirrorConfig, "mirror");

		expect(result).toEqual({ repositoryId: "mirror", compatible: false, reason: expect.any(String) });
		expect(result.reason).toMatch(/private keys and SSH settings/);
		expect(getIncompatibleMirrorError("Mirror", "sftp", "sftp")).toContain(result.reason);
	}
});

test("preserves unrelated backend compatibility and credential rejection", async () => {
	const s3: RepositoryConfig = {
		backend: "s3",
		endpoint: "https://s3.example.com",
		bucket: "backup",
		accessKeyId: "access",
		secretAccessKey: "secret",
	};

	expect(await checkMirrorCompatibility(s3, { ...s3, bucket: "mirror" }, "mirror")).toMatchObject({
		compatible: true,
		reason: null,
	});
	expect(await checkMirrorCompatibility(s3, { ...s3, secretAccessKey: "other" }, "mirror")).toMatchObject({
		compatible: false,
		reason: "Both use S3 backends with different credentials",
	});
	expect(await checkMirrorCompatibility(sftp, s3, "mirror")).toMatchObject({ compatible: true, reason: null });
	expect(await checkMirrorCompatibility(sftp, { backend: "local", path: "/mirror" }, "mirror")).toMatchObject({
		compatible: true,
		reason: null,
	});
});
