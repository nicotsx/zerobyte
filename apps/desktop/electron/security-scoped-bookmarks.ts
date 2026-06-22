import { safeJsonParse } from "@zerobyte/core/utils";
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

type SecurityScopedBookmarkGrant = {
	path: string;
	bookmark: string;
};

const activeAccessorsByPath = new Map<string, () => void>();

const getStorePath = () => path.join(app.getPath("userData"), "data", "security-scoped-bookmarks.json");

const readGrants = async (): Promise<SecurityScopedBookmarkGrant[]> => {
	try {
		const file = await fs.readFile(getStorePath(), "utf-8");
		return safeJsonParse<SecurityScopedBookmarkGrant[]>(file) ?? [];
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return [];
		}

		throw error;
	}
};

const writeGrants = async (grants: SecurityScopedBookmarkGrant[]) => {
	const storePath = getStorePath();
	await fs.mkdir(path.dirname(storePath), { recursive: true });
	await fs.writeFile(storePath, JSON.stringify(grants, null, 2), "utf-8");
};

const startAccessingBookmark = (bookmarkPath: string, bookmark: string) => {
	if (process.platform !== "darwin") {
		return;
	}

	activeAccessorsByPath.get(bookmarkPath)?.();
	const stopAccessing = app.startAccessingSecurityScopedResource(bookmark);
	activeAccessorsByPath.set(bookmarkPath, () => stopAccessing());
};

export const saveSecurityScopedBookmark = async ({
	path: selectedPath,
	bookmark,
}: Pick<SecurityScopedBookmarkGrant, "path"> & { bookmark?: string }) => {
	if (!bookmark) return;

	const grants = (await readGrants()).filter((grant) => grant.path !== selectedPath);

	grants.push({ path: selectedPath, bookmark });

	await writeGrants(grants);
	startAccessingBookmark(selectedPath, bookmark);
};

export const startAccessingSavedBookmarks = async () => {
	if (process.platform !== "darwin") {
		return () => {};
	}

	for (const grant of await readGrants()) {
		startAccessingBookmark(grant.path, grant.bookmark);
	}

	return () => {
		for (const stopAccessing of activeAccessorsByPath.values()) {
			stopAccessing();
		}

		activeAccessorsByPath.clear();
	};
};
