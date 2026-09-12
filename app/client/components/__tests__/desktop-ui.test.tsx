import { afterEach, expect, test, vi } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { cleanup, render, screen, userEvent } from "~/test/test-utils";
import { FolderSelector } from "../folder-selector";
import { ThemeProvider } from "../theme-provider";

afterEach(() => {
	cleanup();
	delete window.zerobyteDesktop;
});

test("uses the native folder picker inside Electron", async () => {
	const chooseFolder = vi.fn().mockResolvedValue("/Users/test/Documents");
	const onChange = vi.fn();
	window.zerobyteDesktop = fromPartial({ chooseFolder });
	render(<FolderSelector value="" onChange={onChange} />);
	await userEvent.click(screen.getByRole("button", { name: "Choose" }));
	expect(chooseFolder).toHaveBeenCalledTimes(1);
	expect(onChange).toHaveBeenCalledWith("/Users/test/Documents");
});

test("offers the web folder browser without Electron", async () => {
	render(
		<FolderSelector
			value=""
			onChange={vi.fn()}
			webBrowser={{
				warning: { title: "Browse server folders", description: "Select a folder on the server." },
			}}
		/>,
	);
	await userEvent.click(screen.getByRole("button", { name: "Change" }));
	expect(screen.getByRole("alertdialog").textContent).toContain("Browse server folders");
	expect(screen.queryByRole("button", { name: "Choose" })).toBeNull();
});

test("synchronizes theme changes with Electron", () => {
	const nativeSetTheme = vi.fn();
	window.zerobyteDesktop = fromPartial({ setTheme: nativeSetTheme });
	const setTheme = vi.fn();
	const { rerender } = render(
		<ThemeProvider theme="dark" setTheme={setTheme}>
			content
		</ThemeProvider>,
	);
	expect(nativeSetTheme).toHaveBeenLastCalledWith("dark");
	rerender(
		<ThemeProvider theme="light" setTheme={setTheme}>
			content
		</ThemeProvider>,
	);
	expect(nativeSetTheme).toHaveBeenLastCalledWith("light");
});
