import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

type ThemeContextValue = {
	theme: Theme;
	setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const THEME_COOKIE_NAME = "theme";
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year
const DEFAULT_THEME: Theme = "dark";

function applyTheme(theme: Theme) {
	const isDark =
		theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
	document.documentElement.classList.toggle("dark", isDark);
	document.documentElement.style.colorScheme = isDark ? "dark" : "light";
}

export function ThemeProvider({ children, initialTheme }: { children: React.ReactNode; initialTheme?: Theme }) {
	const [theme, setThemeState] = useState<Theme>(initialTheme ?? DEFAULT_THEME);

	const setTheme = useCallback((newTheme: Theme) => {
		setThemeState(newTheme);
		document.cookie = `${THEME_COOKIE_NAME}=${newTheme}; path=/; max-age=${THEME_COOKIE_MAX_AGE}`;
		applyTheme(newTheme);
	}, []);

	useEffect(() => {
		if (theme !== "system") {
			return;
		}

		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => applyTheme("system");

		media.addEventListener("change", onChange);
		return () => {
			media.removeEventListener("change", onChange);
		};
	}, [theme]);

	return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>;
}

export function useTheme() {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}
	return context;
}
