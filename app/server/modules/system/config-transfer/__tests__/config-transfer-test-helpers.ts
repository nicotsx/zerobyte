import { readFile } from "node:fs/promises";

export const loadConfigTransferPayloadFixture = async () => {
	return JSON.parse(
		await readFile(new URL("../../__fixtures__/config-transfer/v1-full.payload.json", import.meta.url), "utf8"),
	);
};
