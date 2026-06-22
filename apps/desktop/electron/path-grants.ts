import { dialog, type BrowserWindow, type OpenDialogOptions } from "electron";
import { saveSecurityScopedBookmark } from "./security-scoped-bookmarks";

export const chooseFolder = async (window: BrowserWindow | null) => {
	const dialogOptions: OpenDialogOptions = {
		properties: ["openDirectory", "createDirectory"],
		securityScopedBookmarks: true,
	};

	const result = window
		? await dialog.showOpenDialog(window, dialogOptions)
		: await dialog.showOpenDialog(dialogOptions);

	if (result.canceled || !result.filePaths[0]) {
		return null;
	}

	const selectedPath = result.filePaths[0];
	await saveSecurityScopedBookmark({ path: selectedPath, bookmark: result.bookmarks?.[0] });

	return selectedPath;
};
