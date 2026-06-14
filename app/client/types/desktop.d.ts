type ZerobyteDesktopApi = {
	chooseFolder: () => Promise<string | null>;
	setTheme: (theme: "light" | "dark") => void;
};

declare global {
	interface Window {
		zerobyteDesktop?: ZerobyteDesktopApi;
	}
}

export {};
