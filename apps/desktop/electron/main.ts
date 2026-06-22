import { app, BrowserWindow, dialog, ipcMain, nativeTheme, type OpenDialogOptions, type Tray } from "electron";
import { toMessage } from "@zerobyte/core/utils";
import { startDesktopRuntime, type DesktopRuntime } from "./desktop-runtime";
import { createDesktopSession } from "./desktop-session";
import { createTray, createTrayPopoverWindow, toggleTrayPopover, updateTrayStatus } from "./desktop-tray";
import { createDesktopWindow } from "./desktop-window";
import { saveSecurityScopedBookmark, startAccessingSavedBookmarks } from "./security-scoped-bookmarks";

const trayStatusPollMs = 30_000;

type BackupScheduleTrayStatus = {
	lastBackupStatus: "success" | "error" | "in_progress" | "warning" | null;
};

let mainWindow: BrowserWindow | null = null;
let trayPopoverWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let runtime: DesktopRuntime | null = null;
let authCookieHeader: string | null = null;
let stopAccessingBookmarks: (() => void) | null = null;
let isQuitting = false;
let trayStatusTimer: ReturnType<typeof setInterval> | null = null;

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
	if (trayPopoverWindow && !trayPopoverWindow.isDestroyed()) {
		trayPopoverWindow.hide();
	}
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

const isTrustedDesktopSender = (senderUrl?: string) => {
	if (!runtime || !senderUrl) {
		return false;
	}

	try {
		return new URL(senderUrl).origin === new URL(runtime.url).origin;
	} catch {
		return false;
	}
};

const chooseFolder = async () => {
	const dialogOptions: OpenDialogOptions = {
		properties: ["openDirectory", "createDirectory"],
		securityScopedBookmarks: true,
	};

	const result = mainWindow
		? await dialog.showOpenDialog(mainWindow, dialogOptions)
		: await dialog.showOpenDialog(dialogOptions);

	if (result.canceled || !result.filePaths[0]) {
		return null;
	}

	const selectedPath = result.filePaths[0];
	const bookmark = result.bookmarks?.[0];
	if (process.platform === "darwin" && (process as NodeJS.Process & { mas?: boolean }).mas && !bookmark) {
		throw new Error("Failed to create security-scoped bookmark");
	}

	await saveSecurityScopedBookmark(selectedPath, bookmark);

	return selectedPath;
};

const getTrayPopoverWindow = async () => {
	if (!runtime) {
		throw new Error("Zerobyte server is not running");
	}

	if (trayPopoverWindow && !trayPopoverWindow.isDestroyed()) {
		return trayPopoverWindow;
	}

	trayPopoverWindow = await createTrayPopoverWindow({
		serverUrl: runtime.url,
		isQuitting: () => isQuitting,
	});

	return trayPopoverWindow;
};

const refreshTrayStatus = async () => {
	if (!runtime || !tray || !authCookieHeader) {
		return;
	}

	try {
		const response = await fetch(`${runtime.url}/api/v1/backups`, {
			headers: {
				cookie: authCookieHeader,
			},
		});

		if (!response.ok) {
			return;
		}

		const schedules = (await response.json()) as BackupScheduleTrayStatus[];
		const runningCount = schedules.filter((schedule) => schedule.lastBackupStatus === "in_progress").length;
		const attentionCount = schedules.filter(
			(schedule) => schedule.lastBackupStatus === "error" || schedule.lastBackupStatus === "warning",
		).length;

		updateTrayStatus(tray, { runningCount, attentionCount });
	} catch {
		// The server can be temporarily unavailable during startup or shutdown.
	}
};

const setupTray = () => {
	tray = createTray({
		openWindow: () => void createWindow(),
		togglePopover: (bounds) => {
			void getTrayPopoverWindow()
				.then((window) => toggleTrayPopover(window, bounds))
				.catch((error) => {
					dialog.showErrorBox("Zerobyte tray failed to open", toMessage(error));
				});
		},
		quit: quitApp,
	});
};

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", focusMainWindow);

	void app.whenReady().then(async () => {
		try {
			nativeTheme.themeSource = "dark";
			stopAccessingBookmarks = await startAccessingSavedBookmarks();
			runtime = await startDesktopRuntime((status) => {
				dialog.showErrorBox("Zerobyte stopped", `Server process exited with ${status}`);
			});
			authCookieHeader = await createDesktopSession(runtime.url, runtime.launchSecret);
			setupTray();
			void refreshTrayStatus();
			trayStatusTimer = setInterval(() => void refreshTrayStatus(), trayStatusPollMs);
			await createWindow();
		} catch (error) {
			if (trayStatusTimer) clearInterval(trayStatusTimer);
			stopAccessingBookmarks?.();
			stopAccessingBookmarks = null;
			dialog.showErrorBox("Zerobyte failed to start", toMessage(error));
			quitApp();
		}
	});
}

app.on("before-quit", () => {
	isQuitting = true;
	if (trayStatusTimer) clearInterval(trayStatusTimer);
	runtime?.stop();
	runtime = null;
	authCookieHeader = null;
	stopAccessingBookmarks?.();
	stopAccessingBookmarks = null;
});

app.on("window-all-closed", () => {});

ipcMain.handle("desktop:choose-folder", (event) => {
	if (!isTrustedDesktopSender(event.senderFrame?.url)) {
		throw new Error("Invalid desktop IPC sender");
	}

	return chooseFolder();
});
ipcMain.handle("desktop:open-main-window", (event, appPath?: unknown) => {
	if (!isTrustedDesktopSender(event.senderFrame?.url)) {
		throw new Error("Invalid desktop IPC sender");
	}

	if (
		appPath !== undefined &&
		(typeof appPath !== "string" || !appPath.startsWith("/") || appPath.startsWith("//"))
	) {
		throw new Error("Invalid app path");
	}

	return createWindow(appPath);
});
ipcMain.on("desktop:quit", (event) => {
	if (!isTrustedDesktopSender(event.senderFrame?.url)) return;
	quitApp();
});
ipcMain.on("desktop:set-theme", (event, theme) => {
	if (!isTrustedDesktopSender(event.senderFrame?.url)) return;
	if (theme === "light" || theme === "dark") {
		nativeTheme.themeSource = theme;
	}
});
