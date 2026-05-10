import fs from "node:fs/promises";

export const FILE_MODES = {
	ownerReadWrite: 0o600,
} as const;

type FileMode = (typeof FILE_MODES)[keyof typeof FILE_MODES];

export const writeFileWithMode = async (filePath: string, data: string, mode: FileMode) => {
	// Remove any existing file first so the mode option on writeFile is always applied
	// on a fresh file creation (mode is ignored for existing files). This also avoids
	// inheriting incorrect permissions from a previously-created file on filesystems
	// where chmod may not behave as expected (e.g. Docker bind-mounts on some NAS systems).
	await fs.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "ENOENT") throw error;
	});
	await fs.writeFile(filePath, data, { mode });
	await fs.chmod(filePath, mode);
};
