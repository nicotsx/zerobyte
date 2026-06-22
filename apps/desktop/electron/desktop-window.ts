import { BrowserWindow } from "electron";
import path from "node:path";

type DesktopWindowOptions = {
	currentWindow: BrowserWindow | null;
	serverUrl: string;
	isQuitting: () => boolean;
	appPath?: string;
};

const normalizeAppPath = (appPath = "/volumes") => {
	if (!appPath.startsWith("/") || appPath.startsWith("//")) {
		return "/volumes";
	}

	return appPath;
};

const focusWindow = (window: BrowserWindow) => {
	window.show();
	if (window.isMinimized()) {
		window.restore();
	}
	window.focus();
};

export const createDesktopWindow = async ({ currentWindow, serverUrl, isQuitting, appPath }: DesktopWindowOptions) => {
	if (currentWindow && !currentWindow.isDestroyed()) {
		if (appPath) {
			await currentWindow.loadURL(`${serverUrl}${normalizeAppPath(appPath)}`);
		}
		focusWindow(currentWindow);
		return currentWindow;
	}

	const window = new BrowserWindow({
		width: 1280,
		height: 840,
		minWidth: 960,
		minHeight: 640,
		title: "Zerobyte",
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});

	window.on("close", (event) => {
		if (!isQuitting()) {
			event.preventDefault();
			window.hide();
		}
	});

	await window.loadURL(`${serverUrl}${normalizeAppPath(appPath)}`);
	return window;
};
