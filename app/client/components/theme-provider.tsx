import { createContext, useCallback, useContext, useState } from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
	theme: Theme;
	setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const THEME_COOKIE_NAME = "theme";
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year
const DEFAULT_THEME: Theme = "dark";

export function ThemeProvider({ children, initialTheme }: { children: React.ReactNode; initialTheme?: Theme }) {
	const [theme, setThemeState] = useState<Theme>(initialTheme ?? DEFAULT_THEME);

	const setTheme = useCallback((newTheme: Theme) => {
		setThemeState(newTheme);
		document.cookie = `${THEME_COOKIE_NAME}=${newTheme}; path=/; max-age=${THEME_COOKIE_MAX_AGE}`;
		document.documentElement.classList.toggle("dark", newTheme === "dark");
		document.documentElement.style.colorScheme = newTheme;
	}, []);

	return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>;
}

export function useTheme() {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}
	return context;
}
