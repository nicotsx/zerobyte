import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "vitest";
import type { ScenarioFixture } from "./fixture";

type ResticLsNode = {
	path: string;
	type: string;
};

const nodeByPath = (nodes: ResticLsNode[]) => new Map(nodes.map((node) => [path.normalize(node.path), node]));

export const assertSnapshotContainsFixture = (sourceRoot: string, nodes: ResticLsNode[], fixture: ScenarioFixture) => {
	const nodesByPath = nodeByPath(nodes);

	const regularFile = nodesByPath.get(path.join(sourceRoot, fixture.regularFile.relativePath));
	expect(regularFile?.type).toBe("file");

	const nestedDirectory = nodesByPath.get(path.join(sourceRoot, fixture.nestedDirectory.relativePath));
	expect(nestedDirectory?.type).toBe("dir");

	const nestedFile = nodesByPath.get(path.join(sourceRoot, fixture.nestedFile.relativePath));
	expect(nestedFile?.type).toBe("file");

	const symlink = nodesByPath.get(path.join(sourceRoot, fixture.symlink.relativePath));
	expect(symlink?.type).toBe("symlink");
};

export const assertRestoredFixture = async (restoreRoot: string, fixture: ScenarioFixture) => {
	await expect(fs.readFile(path.join(restoreRoot, fixture.regularFile.relativePath), "utf8")).resolves.toBe(
		fixture.regularFile.content,
	);

	const nestedDirectoryStat = await fs.stat(path.join(restoreRoot, fixture.nestedDirectory.relativePath));
	expect(nestedDirectoryStat.isDirectory()).toBe(true);

	await expect(fs.readFile(path.join(restoreRoot, fixture.nestedFile.relativePath), "utf8")).resolves.toBe(
		fixture.nestedFile.content,
	);

	await expect(fs.readlink(path.join(restoreRoot, fixture.symlink.relativePath))).resolves.toBe(
		fixture.symlink.target,
	);
};
