import { app, BrowserWindow, Menu, nativeImage, screen, Tray, type Rectangle } from "electron";
import path from "node:path";

const trayIconFileName = "tray-icon.png";
const trayIconSize = 18;
const trayPopoverWidth = 390;
const trayPopoverHeight = 520;
const trayPopoverGap = 8;

type TrayStatus = {
	runningCount: number;
	attentionCount: number;
};

type TrayPopoverWindowOptions = {
	serverUrl: string;
	isQuitting: () => boolean;
};

type TrayOptions = {
	openWindow: () => void;
	togglePopover: (bounds: Rectangle) => void;
	quit: () => void;
};

const createTrayIcon = () => {
	let trayIconPath = path.join(app.getAppPath(), "assets", trayIconFileName);
	if (app.isPackaged) {
		trayIconPath = path.join(process.resourcesPath, trayIconFileName);
	}

	const trayIcon = nativeImage.createFromPath(trayIconPath).resize({
		width: trayIconSize,
		height: trayIconSize,
	});

	if (process.platform === "darwin") {
		trayIcon.setTemplateImage(true);
	}

	return trayIcon;
};

const formatTrayTooltip = ({ runningCount, attentionCount }: TrayStatus) => {
	const parts = ["Zerobyte"];

	if (runningCount > 0) {
		parts.push(`${runningCount} running`);
	}
	if (attentionCount > 0) {
		parts.push(`${attentionCount} need attention`);
	}

	return parts.join(" | ");
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const positionTrayPopover = (window: BrowserWindow, trayBounds: Rectangle) => {
	const trayCenterX = Math.round(trayBounds.x + trayBounds.width / 2);
	const trayCenterY = Math.round(trayBounds.y + trayBounds.height / 2);
	const display = screen.getDisplayNearestPoint({
		x: trayCenterX,
		y: trayCenterY,
	});
	const { workArea } = display;

	const minX = workArea.x;
	const maxX = workArea.x + workArea.width - trayPopoverWidth;
	const centeredX = Math.round(trayCenterX - trayPopoverWidth / 2);
	const x = clamp(centeredX, minX, maxX);

	const yBelowTray = Math.round(trayBounds.y + trayBounds.height + trayPopoverGap);
	const yAboveTray = Math.round(trayBounds.y - trayPopoverHeight - trayPopoverGap);
	const minY = workArea.y;
	const maxY = workArea.y + workArea.height - trayPopoverHeight;

	let y = yAboveTray;
	if (process.platform === "darwin") {
		y = yBelowTray;
	}

	if (y > maxY) {
		y = yAboveTray;
	}
	if (y < minY) {
		y = yBelowTray;
	}

	window.setBounds({
		x,
		y: clamp(y, minY, maxY),
		width: trayPopoverWidth,
		height: trayPopoverHeight,
	});
};

export const updateTrayStatus = (tray: Tray, status: TrayStatus) => {
	tray.setToolTip(formatTrayTooltip(status));
};

export const createTrayPopoverWindow = async ({ serverUrl, isQuitting }: TrayPopoverWindowOptions) => {
	const window = new BrowserWindow({
		width: trayPopoverWidth,
		height: trayPopoverHeight,
		show: false,
		frame: false,
		resizable: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		title: "Zerobyte",
		backgroundColor: "#131313",
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});

	window.on("blur", () => {
		window.hide();
	});

	window.on("close", (event) => {
		if (!isQuitting()) {
			event.preventDefault();
			window.hide();
		}
	});

	window.webContents.on("before-input-event", (event, input) => {
		if (input.key === "Escape") {
			event.preventDefault();
			window.hide();
		}
	});

	await window.loadURL(`${serverUrl}/desktop/tray`);
	return window;
};

export const toggleTrayPopover = (window: BrowserWindow, trayBounds: Rectangle) => {
	if (window.isVisible()) {
		window.hide();
		return;
	}

	positionTrayPopover(window, trayBounds);
	window.show();
	window.focus();
};

export const createTray = ({ openWindow, togglePopover, quit }: TrayOptions) => {
	const tray = new Tray(createTrayIcon());
	updateTrayStatus(tray, { runningCount: 0, attentionCount: 0 });

	if (process.platform === "darwin") {
		tray.setIgnoreDoubleClickEvents(true);
	}

	tray.on("click", (_event, bounds) => {
		togglePopover(bounds);
	});

	tray.on("right-click", () => {
		tray.popUpContextMenu(
			Menu.buildFromTemplate([
				{ label: "Open Zerobyte", click: openWindow },
				{ type: "separator" },
				{ label: "Quit Zerobyte", click: quit },
			]),
		);
	});

	return tray;
};
