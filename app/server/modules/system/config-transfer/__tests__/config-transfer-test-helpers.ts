import { readFile } from "node:fs/promises";
import { vi } from "vitest";
import { createApp } from "~/server/app";
import * as authHelpers from "~/server/modules/auth/helpers";
import { encryptConfigTransferPayload as encryptConfig } from "../envelope";

const app = createApp();

export const fixturePassphrase = "fixture-export-passphrase-for-config-transfer-v1";

export const requestConfigExport = (
	headers: Record<string, string>,
	password = "",
	exportPassphrase = fixturePassphrase,
) => {
	return app.request("/api/v1/system/config-export", {
		method: "POST",
		headers: { ...headers, "Content-Type": "application/json" },
		body: JSON.stringify({ password, exportPassphrase }),
	});
};

export const requestConfigImport = (
	headers: Record<string, string>,
	encryptedConfig: string,
	exportPassphrase = fixturePassphrase,
) => {
	return app.request("/api/v1/system/config-import", {
		method: "POST",
		headers: { ...headers, "Content-Type": "application/json" },
		body: JSON.stringify({ encryptedConfig, exportPassphrase }),
	});
};

export const loadPayload = async () => {
	return JSON.parse(
		await readFile(new URL("../../__fixtures__/config-transfer/v1-full.payload.json", import.meta.url), "utf8"),
	);
};

export const loadEncryptedConfig = async () => {
	return (await readFile(new URL("../../__fixtures__/config-transfer/v1-full.zbex", import.meta.url), "utf8")).trim();
};

export const encryptPayload = (payload: unknown) => encryptConfig(JSON.stringify(payload), fixturePassphrase);

export const allowConfigExportPassword = () => {
	vi.spyOn(authHelpers, "userHasPassword").mockResolvedValueOnce(true);
	vi.spyOn(authHelpers, "verifyUserPassword").mockResolvedValueOnce(true);
};
