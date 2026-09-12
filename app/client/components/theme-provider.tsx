import { createContext, useContext, useEffect } from "react";
import { useIsDesktop } from "~/client/hooks/use-is-desktop";

export type Theme = "light" | "dark";

type ThemeContextValue = {
	theme: Theme;
	setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const THEME_COOKIE_NAME = "theme";
export const DEFAULT_THEME: Theme = "dark";

export function ThemeProvider({ children, theme, setTheme }: ThemeContextValue & { children: React.ReactNode }) {
	const isDesktop = useIsDesktop();
	useEffect(() => {
		if (isDesktop) window.zerobyteDesktop?.setTheme(theme);
	}, [isDesktop, theme]);

	return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>;
}

export function useTheme() {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}
	return context;
}
