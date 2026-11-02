import type { RepositoryConfig } from "@zerobyte/core/restic";
import { expect, test, vi } from "vitest";
import { backupsService } from "../backups.service";
import { withContext } from "~/server/core/request-context";
import { cryptoUtils } from "~/server/utils/crypto";
import { createTestBackupSchedule } from "~/test/helpers/backup";
import { TEST_ORG_ID } from "~/test/helpers/organization";
import { createTestRepository } from "~/test/helpers/repository";

vi.unmock("~/server/utils/crypto");

test("lists and saves compatible SFTP mirrors and consistently explains rejected SSH settings", async () => {
	const config: RepositoryConfig = {
		backend: "sftp",
		host: "source.example.com",
		user: "backup",
		path: "/source",
		privateKey: await cryptoUtils.sealSecret("private-key"),
		port: 22,
		skipHostKeyCheck: false,
		allowLegacySshRsa: false,
	};
	const source = await createTestRepository({ type: "sftp", config });
	const mirror = await createTestRepository({
		type: "sftp",
		config: {
			...config,
			host: "mirror.example.com",
			user: "mirror",
			path: "/mirror",
			privateKey: await cryptoUtils.sealSecret("private-key\n"),
		},
	});
	const incompatible = await createTestRepository({
		type: "sftp",
		config: { ...config, skipHostKeyCheck: true },
	});
	const schedule = await createTestBackupSchedule({ repositoryId: source.id });

	await withContext({ organizationId: TEST_ORG_ID }, async () => {
		const compatibility = await backupsService.getMirrorCompatibility(schedule.shortId);
		const rejected = compatibility.find((result) => result.repositoryId === incompatible.shortId);

		expect(compatibility).toContainEqual({ repositoryId: mirror.shortId, compatible: true, reason: null });
		expect(rejected).toMatchObject({
			compatible: false,
			reason: expect.stringMatching(/private keys and SSH settings/),
		});

		const mirrors = await backupsService.updateMirrors(schedule.shortId, {
			mirrors: [{ repositoryId: mirror.shortId, enabled: true }],
		});

		expect(mirrors).toMatchObject([{ repositoryId: mirror.shortId, enabled: true }]);
		await expect(
			backupsService.updateMirrors(schedule.shortId, {
				mirrors: [{ repositoryId: incompatible.shortId, enabled: true }],
			}),
		).rejects.toThrow(rejected!.reason!);
		expect(await backupsService.getMirrors(schedule.shortId)).toMatchObject([{ repositoryId: mirror.shortId }]);
	});
});

test("only accepts mirrors that the source machine can reach", async () => {
	const source = await createTestRepository({
		type: "local",
		agentId: "source-machine",
		config: { backend: "local", path: "/srv/source" },
	});
	const otherMachine = await createTestRepository({
		type: "local",
		agentId: "other-machine",
		config: { backend: "local", path: "/srv/other" },
	});
	const serverLocal = await createTestRepository({
		type: "local",
		config: { backend: "local", path: "/srv/server" },
	});
	const rest = await createTestRepository({
		type: "rest",
		config: { backend: "rest", url: "https://rest.example.test" } as RepositoryConfig,
	});
	const schedule = await createTestBackupSchedule({ repositoryId: source.id });

	await withContext({ organizationId: TEST_ORG_ID }, async () => {
		await expect(
			backupsService.updateMirrors(schedule.shortId, {
				mirrors: [{ repositoryId: otherMachine.shortId, enabled: true }],
			}),
		).rejects.toThrow("Repositories stored on different machines cannot mirror each other.");
		await expect(
			backupsService.updateMirrors(schedule.shortId, {
				mirrors: [{ repositoryId: serverLocal.shortId, enabled: true }],
			}),
		).rejects.toThrow("can only mirror with repositories that machine can reach");

		const mirrors = await backupsService.updateMirrors(schedule.shortId, {
			mirrors: [{ repositoryId: rest.shortId, enabled: true }],
		});

		expect(mirrors).toMatchObject([{ repositoryId: rest.shortId, enabled: true }]);
		expect(await backupsService.getMirrorCompatibility(schedule.shortId)).toContainEqual(
			expect.objectContaining({ repositoryId: serverLocal.shortId, compatible: false }),
		);
	});
});
