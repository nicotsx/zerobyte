import fs from "node:fs/promises";

export const FILE_MODES = {
	ownerReadWrite: 0o600,
} as const;

type FileMode = (typeof FILE_MODES)[keyof typeof FILE_MODES];

/**
 * Checks whether an existing file has the expected mode and, if not, applies chmod.
 * Returns true when the mode was corrected, false when the file already had the
 * correct mode or does not exist.
 */
export const ensureFileMode = async (filePath: string, mode: FileMode): Promise<boolean> => {
	let stat;
	try {
		stat = await fs.stat(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw error;
	}

	if ((stat.mode & 0o777) !== mode) {
		await fs.chmod(filePath, mode);
		return true;
	}

	return false;
};

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
