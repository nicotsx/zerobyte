import { describe, expect, it } from "vitest";
import { createUsageFold } from "../fold";
import type { UsageNode, UsageTree } from "../types";

const dir = (path: string, mtime = 0): UsageNode => ({ path, type: "dir", mtime });
const file = (path: string, size: number, mtime = 0): UsageNode => ({ path, type: "file", size, mtime });

const fold = (nodes: UsageNode[], options?: Parameters<typeof createUsageFold>[0]): UsageTree => {
	const instance = createUsageFold(options);
	for (const node of nodes) instance.push(node);
	return instance.finish();
};

const dirAt = (tree: UsageTree, path: string) => tree.dirs.find((entry) => entry.path === path);

describe("createUsageFold", () => {
	it("rolls file sizes up into every ancestor", () => {
		const tree = fold([
			dir("/data"),
			dir("/data/a"),
			file("/data/a/one.txt", 100),
			file("/data/a/two.txt", 200),
			dir("/data/b"),
			file("/data/b/three.txt", 50),
		]);

		expect(dirAt(tree, "/data")?.size).toBe(350);
		expect(dirAt(tree, "/data/a")?.size).toBe(300);
		expect(dirAt(tree, "/data/b")?.size).toBe(50);
		expect(tree.totals).toEqual({ size: 350, fileCount: 3, dirCount: 3 });
	});

	it("separates a directory's own bytes from its subtree total", () => {
		const tree = fold([
			dir("/data"),
			file("/data/loose.bin", 10),
			dir("/data/nested"),
			file("/data/nested/deep.bin", 90),
		]);

		const root = dirAt(tree, "/data");
		expect(root?.size).toBe(100);
		expect(root?.ownSize).toBe(10);
	});

	it("handles deep nesting without losing bytes", () => {
		const nodes: UsageNode[] = [];
		let path = "";
		for (let depth = 0; depth < 30; depth++) {
			path += `/level${depth}`;
			nodes.push(dir(path));
		}
		nodes.push(file(`${path}/leaf.bin`, 4096));

		const tree = fold(nodes);

		expect(dirAt(tree, "/level0")?.size).toBe(4096);
		expect(dirAt(tree, "/level0")?.dirCount).toBe(29);
		expect(tree.totals.size).toBe(4096);
	});

	it("tracks multiple roots independently", () => {
		const tree = fold([dir("/alpha"), file("/alpha/a.bin", 10), dir("/beta"), file("/beta/b.bin", 20)]);

		expect(dirAt(tree, "/alpha")?.size).toBe(10);
		expect(dirAt(tree, "/beta")?.size).toBe(20);
		expect(tree.roots).toEqual(["/alpha", "/beta"]);
		expect(tree.totals.size).toBe(30);
	});

	it("prefers explicitly supplied roots over observed ones", () => {
		const tree = fold([dir("/mnt/vol"), file("/mnt/vol/a.bin", 1)], { roots: ["/mnt/vol"] });

		expect(tree.roots).toEqual(["/mnt/vol"]);
	});

	it("carries the newest mtime up the tree", () => {
		const tree = fold([
			dir("/data"),
			dir("/data/old"),
			file("/data/old/a.bin", 1, 1000),
			dir("/data/new"),
			file("/data/new/b.bin", 1, 9000),
		]);

		expect(dirAt(tree, "/data")?.maxMtime).toBe(9000);
		expect(dirAt(tree, "/data/old")?.maxMtime).toBe(1000);
	});

	it("keeps zero-byte files and unicode or space-bearing names", () => {
		const tree = fold([
			dir("/data"),
			file("/data/empty.bin", 0),
			dir("/data/ünïcode dir"),
			file("/data/ünïcode dir/spaced name.txt", 5),
		]);

		expect(tree.files.map((entry) => entry.path)).toContain("/data/empty.bin");
		expect(dirAt(tree, "/data/ünïcode dir")?.size).toBe(5);
		expect(dirAt(tree, "/data/ünïcode dir")?.name).toBe("ünïcode dir");
	});

	it("keeps large files as entries so a drill-down is never empty", () => {
		const tree = fold([dir("/data"), file("/data/huge.iso", 5_000_000_000)]);

		expect(tree.files).toEqual([{ path: "/data/huge.iso", size: 5_000_000_000, mtime: 0 }]);
		expect(tree.largestFiles[0]?.path).toBe("/data/huge.iso");
	});

	it("tallies sizes by extension, case-insensitively", () => {
		const tree = fold([
			dir("/data"),
			file("/data/a.ISO", 100),
			file("/data/b.iso", 200),
			file("/data/c.txt", 5),
			file("/data/noext", 1),
			file("/data/.hidden", 2),
		]);

		const iso = tree.byExtension.find((entry) => entry.ext === "iso");
		expect(iso).toEqual({ ext: "iso", size: 300, count: 2 });

		const none = tree.byExtension.find((entry) => entry.ext === "");
		expect(none?.count).toBe(2);
	});

	describe("pruning", () => {
		it("keeps everything when the tree fits under the cap", () => {
			const tree = fold([dir("/data"), file("/data/tiny.bin", 1)]);

			expect(tree.appliedMinSize).toBe(0);
			expect(tree.files).toHaveLength(1);
			expect(dirAt(tree, "/data")?.truncatedChildren).toBeUndefined();
		});

		it("drops the smallest entries once the cap is exceeded", () => {
			const nodes: UsageNode[] = [dir("/data")];
			for (let index = 0; index < 100; index++) {
				nodes.push(file(`/data/file${index}.bin`, index));
			}

			const tree = fold(nodes, { limits: { maxEntries: 10 } });

			expect(tree.appliedMinSize).toBeGreaterThan(0);
			expect(tree.files.length).toBeLessThanOrEqual(10);
			// The biggest files must survive.
			expect(tree.largestFiles[0]?.path).toBe("/data/file99.bin");
		});

		it("accounts for pruned children so the numbers still add up", () => {
			const nodes: UsageNode[] = [dir("/data")];
			for (let index = 0; index < 100; index++) {
				nodes.push(file(`/data/file${index}.bin`, index));
			}

			const tree = fold(nodes, { limits: { maxEntries: 10 } });
			const root = dirAt(tree, "/data");
			const keptChildren = tree.files.filter((entry) => entry.path.startsWith("/data/"));
			const keptSize = keptChildren.reduce((sum, entry) => sum + entry.size, 0);

			expect(root).toBeDefined();
			expect(root?.truncatedChildren?.count).toBe(100 - keptChildren.length);
			expect((root?.truncatedChildren?.size ?? 0) + keptSize).toBe(root?.size);
		});

		it("converges when many entries share the cutoff size", () => {
			const nodes: UsageNode[] = [dir("/data")];
			for (let index = 0; index < 500; index++) {
				nodes.push(file(`/data/file${index}.bin`, 100));
			}

			const tree = fold(nodes, { limits: { maxEntries: 10 } });

			// Every file ties at 100, so the escalation must clear them all rather
			// than spinning while the map stays over the cap.
			expect(tree.files).toHaveLength(0);
			expect(tree.totals.fileCount).toBe(500);
			expect(dirAt(tree, "/data")?.size).toBe(50_000);
		});

		it("never loses bytes from the totals, however hard it prunes", () => {
			const nodes: UsageNode[] = [dir("/data")];
			let expected = 0;
			for (let index = 0; index < 2000; index++) {
				nodes.push(dir(`/data/dir${index}`));
				nodes.push(file(`/data/dir${index}/f.bin`, index));
				expected += index;
			}

			const tree = fold(nodes, { limits: { maxEntries: 25 } });

			expect(tree.totals.size).toBe(expected);
			expect(tree.totals.fileCount).toBe(2000);
			expect(dirAt(tree, "/data")?.size).toBe(expected);
		});
	});

	describe("robustness", () => {
		it("counts skipped entries", () => {
			const instance = createUsageFold();
			instance.push(dir("/data"));
			instance.skip();
			instance.skip();

			expect(instance.finish().skipped).toBe(2);
		});

		it("ignores nodes with an empty path", () => {
			const tree = fold([dir("/data"), { path: "", type: "file", size: 10 }]);

			expect(tree.totals.fileCount).toBe(0);
		});

		it("treats a missing size as zero", () => {
			const tree = fold([dir("/data"), { path: "/data/unknown", type: "file" }]);

			expect(dirAt(tree, "/data")?.size).toBe(0);
			expect(tree.totals.fileCount).toBe(1);
		});

		it("does not double-count a directory emitted twice in a row", () => {
			const tree = fold([dir("/data"), dir("/data"), file("/data/a.bin", 10)]);

			expect(tree.dirs.filter((entry) => entry.path === "/data")).toHaveLength(1);
			expect(dirAt(tree, "/data")?.size).toBe(10);
		});

		it("returns an empty tree when nothing was pushed", () => {
			const tree = fold([]);

			expect(tree.totals).toEqual({ size: 0, fileCount: 0, dirCount: 0 });
			expect(tree.dirs).toEqual([]);
			expect(tree.roots).toEqual([]);
		});
	});
});
