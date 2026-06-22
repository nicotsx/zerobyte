import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("zerobyteDesktop", {
	setTheme: (theme: "light" | "dark") => ipcRenderer.send("desktop:set-theme", theme),
});
