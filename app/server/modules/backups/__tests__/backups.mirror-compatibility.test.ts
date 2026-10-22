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
