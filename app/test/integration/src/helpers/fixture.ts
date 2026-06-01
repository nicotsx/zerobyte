import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type ScenarioFixture = {
	sourceRoot: string;
	regularFile: {
		relativePath: string;
		content: string;
	};
	nestedDirectory: {
		relativePath: string;
	};
	nestedFile: {
		relativePath: string;
		content: string;
	};
	symlink: {
		relativePath: string;
		target: string;
	};
};

export const createScenarioFixture = async (workspace: string, scenarioId: string): Promise<ScenarioFixture> => {
	const sourceRoot = path.join(workspace, "source");
	const nestedDirectory = path.join(sourceRoot, "nested");
	const randomSuffix = crypto.randomBytes(8).toString("hex");

	const fixture: ScenarioFixture = {
		sourceRoot,
		regularFile: {
			relativePath: "regular.txt",
			content: `regular fixture for ${scenarioId} (${randomSuffix})\n`,
		},
		nestedDirectory: {
			relativePath: "nested",
		},
		nestedFile: {
			relativePath: "nested/deep.txt",
			content: `nested fixture for ${scenarioId} (${randomSuffix})\n`,
		},
		symlink: {
			relativePath: "regular-link",
			target: "regular.txt",
		},
	};

	await fs.mkdir(nestedDirectory, { recursive: true });
	await fs.writeFile(path.join(sourceRoot, fixture.regularFile.relativePath), fixture.regularFile.content);
	await fs.writeFile(path.join(sourceRoot, fixture.nestedFile.relativePath), fixture.nestedFile.content);
	await fs.symlink(fixture.symlink.target, path.join(sourceRoot, fixture.symlink.relativePath));

	return fixture;
};
