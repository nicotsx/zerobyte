import { describe, expect, test } from "vitest";
import { buildExcludePatternChoices } from "../exclude-patterns";

describe("buildExcludePatternChoices", () => {
	test("offers the exact path first, unchanged when there's no volume to be relative to", () => {
		const [first] = buildExcludePatternChoices({ path: "/mnt/data/media/raw", type: "dir" });

		expect(first?.id).toBe("exact");
		expect(first?.pattern).toBe("/mnt/data/media/raw");
	});

	test("makes the exact-path pattern relative to the volume, since that's what the executor expects", () => {
		const toDisplayPath = (path: string) => path.replace("/mnt/data", "");
		const [first] = buildExcludePatternChoices({ path: "/mnt/data/media/raw", type: "dir" }, toDisplayPath);

		expect(first?.pattern).toBe("/media/raw");
	});

	test("does not relativize the name or extension patterns, since they match anywhere already", () => {
		const toDisplayPath = (path: string) => path.replace("/mnt/data", "");
		const choices = buildExcludePatternChoices({ path: "/mnt/data/movie.ISO", type: "file" }, toDisplayPath);

		expect(choices.find((choice) => choice.id === "name")?.pattern).toBe("**/movie.ISO");
		expect(choices.find((choice) => choice.id === "extension")?.pattern).toBe("*.ISO");
	});

	test("offers a name pattern that matches anywhere in the tree", () => {
		const choices = buildExcludePatternChoices({ path: "/mnt/data/node_modules", type: "dir" });

		expect(choices.find((choice) => choice.id === "name")?.pattern).toBe("**/node_modules");
	});

	test("offers an extension pattern for files", () => {
		const choices = buildExcludePatternChoices({ path: "/mnt/data/movie.ISO", type: "file" });

		expect(choices.find((choice) => choice.id === "extension")?.pattern).toBe("*.ISO");
	});

	test("does not offer an extension pattern for directories", () => {
		const choices = buildExcludePatternChoices({ path: "/mnt/data/photos.backup", type: "dir" });

		expect(choices.some((choice) => choice.id === "extension")).toBe(false);
	});

	test("treats a leading dot as a hidden file, not an extension", () => {
		const choices = buildExcludePatternChoices({ path: "/mnt/data/.gitignore", type: "file" });

		expect(choices.some((choice) => choice.id === "extension")).toBe(false);
		expect(choices.find((choice) => choice.id === "name")?.pattern).toBe("**/.gitignore");
	});

	test("ignores a trailing dot", () => {
		const choices = buildExcludePatternChoices({ path: "/mnt/data/weird.", type: "file" });

		expect(choices.some((choice) => choice.id === "extension")).toBe(false);
	});

	test("handles names with spaces and unicode", () => {
		const choices = buildExcludePatternChoices({ path: "/mnt/data/Mes Photos ünï", type: "dir" });

		expect(choices.find((choice) => choice.id === "name")?.pattern).toBe("**/Mes Photos ünï");
	});
});
