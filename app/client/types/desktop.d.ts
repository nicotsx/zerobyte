type ZerobyteDesktopApi = {
	chooseFolder: () => Promise<string | null>;
	openMainWindow: (path?: string) => Promise<void>;
	quit: () => void;
	setTheme: (theme: "light" | "dark") => void;
};

declare global {
	interface Window {
		zerobyteDesktop?: ZerobyteDesktopApi;
	}
}

export {};
