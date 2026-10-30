import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cryptoUtils } from "~/server/utils/crypto";
import { STORED_SECRET } from "~/server/utils/stored-secret";
import { systemService } from "../../system.service";
import { prepareImport } from "../prepare-import";
import { InvalidConfigTransferError } from "../errors";
import type { ConfigTransferModel } from "../model";

beforeEach(async () => {
	const actual = await vi.importActual<typeof import("~/server/utils/crypto")>("~/server/utils/crypto");
	vi.spyOn(cryptoUtils, "sealSecret").mockImplementation(actual.cryptoUtils.sealSecret);
	vi.spyOn(cryptoUtils, "resolveSecret").mockImplementation(actual.cryptoUtils.resolveSecret);
	vi.spyOn(systemService, "getSystemInfo").mockResolvedValue({
		runtime: "server",
		capabilities: { rclone: false, sysAdmin: false, volumeBackends: ["smb"], repositoryBackends: ["s3"] },
	});
});

afterEach(() => vi.restoreAllMocks());

const families = ["repository", "volume", "notification", "organization"] as const;

const payloadFor = (family: (typeof families)[number], value: string): ConfigTransferModel => {
	const payload: ConfigTransferModel = {
		resticPassword: "recovery-password",
		machines: [],
		repositories: [],
		volumes: [],
		notificationDestinations: [],
		backupSchedules: [],
		backupScheduleMirrors: [],
		backupScheduleNotifications: [],
	};

	switch (family) {
		case "repository":
			payload.repositories.push({
				ref: "repo",
				name: "Repository",
				compressionMode: "auto",
				autoCheckEnabled: false,
				config: {
					backend: "s3",
					endpoint: "https://s3.example",
					bucket: "backups",
					accessKeyId: "access-key",
					secretAccessKey: value,
				},
			});
			break;
		case "volume":
			payload.volumes.push({
				ref: "volume",
				name: "Volume",
				machineRef: null,
				autoRemount: false,
				sourceKind: "managed",
				config: {
					backend: "smb",
					server: "nas",
					share: "backups",
					port: 445,
					vers: "auto",
					mapToContainerUidGid: false,
					password: value,
				},
			});
			break;
		case "notification":
			payload.notificationDestinations.push({
				ref: "notification",
				name: "Notification",
				enabled: true,
				config: { type: "telegram", botToken: value, chatId: "123" },
			});
			break;
		case "organization":
			payload.resticPassword = value;
			break;
	}

	return payload;
};

test.each(families)("rejects the stored marker in imported %s credentials", async (family) => {
	await expect(prepareImport(payloadFor(family, STORED_SECRET))).rejects.toBeInstanceOf(InvalidConfigTransferError);
	expect(vi.mocked(cryptoUtils.sealSecret).mock.calls.flat()).not.toContain(STORED_SECRET);
});

test.each(families)("seals literal encv1-prefixed plaintext in imported %s credentials", async (family) => {
	const plaintext = "encv1:this-is-a-plaintext-password";
	const { prepared } = await prepareImport(payloadFor(family, plaintext));
	let sealed = prepared.sealedResticPassword;
	if (family === "repository") {
		const config = prepared.repositories[0]?.config;
		if (config?.backend !== "s3") throw new Error("Missing repository fixture");
		sealed = config.secretAccessKey;
	} else if (family === "volume") {
		const volume = prepared.volumes[0];
		if (volume?.sourceKind !== "managed" || volume.config.backend !== "smb")
			throw new Error("Missing volume fixture");
		sealed = volume.config.password!;
	} else if (family === "notification") {
		const config = prepared.notificationDestinations[0]?.config;
		if (config?.type !== "telegram") throw new Error("Missing notification fixture");
		sealed = config.botToken;
	}

	expect(sealed).not.toBe(plaintext);
	await expect(cryptoUtils.resolveSecret(sealed)).resolves.toBe(plaintext);
});
