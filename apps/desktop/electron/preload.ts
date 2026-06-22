import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("zerobyteDesktop", {
	chooseFolder: () => ipcRenderer.invoke("desktop:choose-folder"),
	openMainWindow: (path?: string) => ipcRenderer.invoke("desktop:open-main-window", path),
	quit: () => ipcRenderer.send("desktop:quit"),
	setTheme: (theme: "light" | "dark") => ipcRenderer.send("desktop:set-theme", theme),
});
