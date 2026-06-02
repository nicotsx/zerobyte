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

	for (const entry of fixture.entries) {
		const node = nodesByPath.get(path.join(sourceRoot, entry.relativePath));
		expect(node?.type).toBe(entry.type === "directory" ? "dir" : entry.type);
	}
};

export const assertRestoredFixture = async (restoreRoot: string, fixture: ScenarioFixture) => {
	for (const entry of fixture.entries) {
		const entryPath = path.join(restoreRoot, entry.relativePath);
		if (entry.type === "file") {
			await expect(fs.readFile(entryPath, "utf8")).resolves.toBe(entry.content);
		}
		if (entry.type === "directory") {
			const stats = await fs.stat(entryPath);
			expect(stats.isDirectory()).toBe(true);
		}
		if (entry.type === "symlink") {
			await expect(fs.readlink(entryPath)).resolves.toBe(entry.target);
		}
	}
};

export const assertFixtureSourceExists = async (fixture: ScenarioFixture) => {
	const stats = await fs.stat(fixture.sourceRoot);
	expect(stats.isDirectory()).toBe(true);
	await assertRestoredFixture(fixture.sourceRoot, fixture);
};
