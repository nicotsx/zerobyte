import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type FixtureEntry =
	| {
			type: "file";
			relativePath: string;
			content: string;
	  }
	| {
			type: "directory";
			relativePath: string;
	  }
	| {
			type: "symlink";
			relativePath: string;
			target: string;
	  };

export type ScenarioFixture = {
	sourceRoot: string;
	entries: FixtureEntry[];
};

export const createScenarioFixture = async (workspace: string, scenarioId: string): Promise<ScenarioFixture> => {
	const sourceRoot = path.join(workspace, "source");
	const randomSuffix = crypto.randomBytes(8).toString("hex");

	const fixture: ScenarioFixture = {
		sourceRoot,
		entries: [
			{
				type: "file",
				relativePath: "regular.txt",
				content: `regular fixture for ${scenarioId} (${randomSuffix})\n`,
			},
			{
				type: "directory",
				relativePath: "nested",
			},
			{
				type: "file",
				relativePath: "nested/deep.txt",
				content: `nested fixture for ${scenarioId} (${randomSuffix})\n`,
			},
			{
				type: "symlink",
				relativePath: "regular-link",
				target: "regular.txt",
			},
		],
	};

	for (const entry of fixture.entries) {
		const entryPath = path.join(sourceRoot, entry.relativePath);
		if (entry.type === "file") {
			await fs.mkdir(path.dirname(entryPath), { recursive: true });
			await fs.writeFile(entryPath, entry.content);
		}
		if (entry.type === "directory") {
			await fs.mkdir(entryPath, { recursive: true });
		}
		if (entry.type === "symlink") {
			await fs.mkdir(path.dirname(entryPath), { recursive: true });
			await fs.symlink(entry.target, entryPath);
		}
	}

	return fixture;
};

export const createStaticVolumeFixture = (sourceRoot: string): ScenarioFixture => ({
	sourceRoot,
	entries: [
		{
			type: "file",
			relativePath: "hello.txt",
			content: "hello from zerobyte integration\n",
		},
		{
			type: "directory",
			relativePath: "docs",
		},
		{
			type: "file",
			relativePath: "docs/readme.md",
			content: "fixture documentation\n",
		},
	],
});
