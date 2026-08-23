import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUsageFold } from "../fold";
import type { UsageNode, UsageTree } from "../types";
import { UsageWalkCancelledError, walkSource } from "../walk-source";

let root: string;

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-usage-walk-"));
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

const writeFile = async (relativePath: string, contents: string) => {
	const target = path.join(root, relativePath);
	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.writeFile(target, contents);
	return target;
};

const walk = async (options: Partial<Parameters<typeof walkSource>[0]> = {}): Promise<UsageTree> => {
	const fold = createUsageFold({ roots: [root] });
	await walkSource({ root, fold, ...options });
	return fold.finish();
};

const dirAt = (tree: UsageTree, relativePath: string) =>
	tree.dirs.find((entry) => entry.path === (relativePath ? path.join(root, relativePath) : root));

describe("walkSource", () => {
	it("attributes nested file sizes to every ancestor", async () => {
		await writeFile("a/one.txt", "x".repeat(100));
		await writeFile("a/two.txt", "x".repeat(200));
		await writeFile("b/three.txt", "x".repeat(50));

		const tree = await walk();

		expect(dirAt(tree, "")?.size).toBe(350);
		expect(dirAt(tree, "a")?.size).toBe(300);
		expect(dirAt(tree, "b")?.size).toBe(50);
		expect(tree.totals.fileCount).toBe(3);
	});

	it("emits strict depth-first order so siblings do not steal each other's children", async () => {
		await writeFile("a/deep/leaf.txt", "x".repeat(10));
		await writeFile("b/other.txt", "x".repeat(20));

		const nodes: UsageNode[] = [];
		const fold = createUsageFold({ roots: [root] });
		await walkSource({
			root,
			fold: {
				push: (node) => {
					nodes.push(node);
					fold.push(node);
				},
				skip: fold.skip,
				finish: fold.finish,
			},
		});

		const order = nodes.map((node) => node.path);
		const deepIndex = order.indexOf(path.join(root, "a/deep"));
		const leafIndex = order.indexOf(path.join(root, "a/deep/leaf.txt"));
		const aIndex = order.indexOf(path.join(root, "a"));

		expect(aIndex).toBeLessThan(deepIndex);
		expect(deepIndex).toBeLessThan(leafIndex);

		// Whichever sibling comes first, its whole subtree must precede the other.
		const bIndex = order.indexOf(path.join(root, "b"));
		if (aIndex < bIndex) {
			expect(leafIndex).toBeLessThan(bIndex);
		} else {
			expect(bIndex).toBeLessThan(aIndex);
		}

		expect(dirAt(fold.finish(), "a/deep")?.size).toBe(10);
	});

	it("handles a deep tree without exhausting the stack", async () => {
		const deepPath = Array.from({ length: 80 }, (_, index) => `level${index}`).join("/");
		await writeFile(`${deepPath}/leaf.bin`, "x".repeat(64));

		const tree = await walk();

		expect(dirAt(tree, "level0")?.size).toBe(64);
		expect(tree.totals.size).toBe(64);
	});

	it("records symlinks without following them", async () => {
		await writeFile("real/target.txt", "x".repeat(30));
		await fs.symlink(path.join(root, "real"), path.join(root, "link"));

		const tree = await walk();

		expect(dirAt(tree, "link")).toBeUndefined();
		// The symlink itself is counted once, as a file, and its target is not
		// walked a second time.
		expect(tree.totals.fileCount).toBe(2);
		expect(dirAt(tree, "real")?.size).toBe(30);
	});

	it("walks a file root", async () => {
		const target = await writeFile("solo.txt", "x".repeat(12));

		const fold = createUsageFold();
		await walkSource({ root: target, fold });
		const tree = fold.finish();

		expect(tree.totals).toMatchObject({ size: 12, fileCount: 1 });
	});

	it("skips unreadable directories instead of failing", async () => {
		await writeFile("readable/ok.txt", "x".repeat(10));
		const locked = path.join(root, "locked");
		await fs.mkdir(locked);
		await fs.writeFile(path.join(locked, "secret.txt"), "x".repeat(999));
		await fs.chmod(locked, 0o000);

		const tree = await walk();

		// Running as root defeats the permission bit, so assert the walk survived
		// either way rather than asserting on the skip count.
		expect(dirAt(tree, "readable")?.size).toBe(10);
		expect(tree.totals.size).toBeGreaterThanOrEqual(10);

		await fs.chmod(locked, 0o755);
	});

	it("reports an empty directory as zero rather than erroring", async () => {
		await fs.mkdir(path.join(root, "empty"));

		const tree = await walk();

		expect(dirAt(tree, "empty")?.size).toBe(0);
		expect(tree.totals.fileCount).toBe(0);
	});

	it("stops when the signal aborts", async () => {
		for (let index = 0; index < 50; index++) {
			await writeFile(`dir${index}/file.txt`, "x".repeat(10));
		}

		const controller = new AbortController();
		const fold = createUsageFold({ roots: [root] });
		controller.abort();

		await expect(walkSource({ root, fold, signal: controller.signal })).rejects.toBeInstanceOf(
			UsageWalkCancelledError,
		);
	});

	it("reports progress with a scanned count", async () => {
		await writeFile("a/one.txt", "x");
		await writeFile("a/two.txt", "x");

		const updates: number[] = [];
		await walk({ progressIntervalMs: 0, onProgress: ({ nodesScanned }) => updates.push(nodesScanned) });

		expect(updates.at(-1)).toBe(3);
	});
});
