import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from "electron";
import { toMessage } from "@zerobyte/core/utils";
import { startDesktopRuntime, type DesktopRuntime } from "./desktop-runtime";
import { createDesktopSession } from "./desktop-session";
import { createDesktopWindow } from "./desktop-window";

let mainWindow: BrowserWindow | null = null;
let runtime: DesktopRuntime | null = null;
let isQuitting = false;

const quitApp = () => {
	isQuitting = true;
	app.quit();
};

const createWindow = async (appPath?: string) => {
	if (!runtime) {
		throw new Error("Zerobyte server is not running");
	}

	mainWindow = await createDesktopWindow({
		currentWindow: mainWindow,
		serverUrl: runtime.url,
		isQuitting: () => isQuitting,
		appPath,
	});
};

const focusMainWindow = () => {
	if (!mainWindow || mainWindow.isDestroyed()) {
		return;
	}

	mainWindow.show();
	if (mainWindow.isMinimized()) {
		mainWindow.restore();
	}
	mainWindow.focus();
};

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", focusMainWindow);

	void app.whenReady().then(async () => {
		try {
			nativeTheme.themeSource = "dark";
			runtime = await startDesktopRuntime((status) => {
				dialog.showErrorBox("Zerobyte stopped", `Server process exited with ${status}`);
			});
			await createDesktopSession(runtime.url, runtime.launchSecret);
			await createWindow();
		} catch (error) {
			dialog.showErrorBox("Zerobyte failed to start", toMessage(error));
			quitApp();
		}
	});
}

app.on("before-quit", () => {
	isQuitting = true;
	runtime?.stop();
	runtime = null;
});

app.on("window-all-closed", () => {});

ipcMain.on("desktop:set-theme", (_event, theme) => {
	if (theme === "light" || theme === "dark") {
		nativeTheme.themeSource = theme;
	}
});
