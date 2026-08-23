import { describe, expect, test } from "vitest";
import { buildExcludePatternChoices } from "../exclude-patterns";

describe("buildExcludePatternChoices", () => {
	test("offers the absolute path first, since restic anchors it", () => {
		const [first] = buildExcludePatternChoices({ path: "/mnt/data/media/raw", type: "dir" });

		expect(first?.id).toBe("exact");
		expect(first?.pattern).toBe("/mnt/data/media/raw");
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
