import fs from "node:fs/promises";

export const FILE_MODES = {
	ownerReadWrite: 0o600,
} as const;

type FileMode = (typeof FILE_MODES)[keyof typeof FILE_MODES];

export const writeFileWithMode = async (filePath: string, data: string, mode: FileMode) => {
	await fs.writeFile(filePath, data, { mode });
	await fs.chmod(filePath, mode);
};
