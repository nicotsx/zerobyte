import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fromPartial } from "@total-typescript/shoehorn";
import { LOCAL_FILESYSTEM_ROOT_ID } from "@zerobyte/contracts/volumes";
import { MAX_AGENT_TRUSTED_ROOTS } from "@zerobyte/contracts/agent-protocol";
import {
	createTrustedRootRegistry,
	getTrustedRootDescriptors,
	normalizeTrustedRelativePath,
	parseConfiguredRoots,
	resolveFilesystemSource,
} from "../trusted-roots";

const temporaryDirectories: string[] = [];

vi.mock("node:fs", async (original) => ({ ...(await original<typeof fs>()) }));
vi.mock("node:path", async (original) => ({ ...(await original<typeof path>()) }));

const createTemporaryDirectory = () => {
	const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-trusted-root-"));
	temporaryDirectories.push(temporaryDirectory);
	return temporaryDirectory;
};

const createRoots = (count: number, rootPath: string) => {
	return Array.from({ length: count }, (_value, index) => ({
		id: `root-${index}`,
		label: `Root ${index}`,
		path: rootPath,
		allowBackup: true,
	}));
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();

	for (const temporaryDirectory of temporaryDirectories.splice(0)) {
		fs.rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

describe("trusted root configuration", () => {
	test("accepts the maximum number of configured roots", () => {
		const rootPath = createTemporaryDirectory();
		const roots = createRoots(MAX_AGENT_TRUSTED_ROOTS, rootPath);
		const registry = createTrustedRootRegistry({ roots });

		expect(registry.size).toBe(MAX_AGENT_TRUSTED_ROOTS);
	});

	test("rejects configurations above the maximum number of roots", () => {
		const rootPath = createTemporaryDirectory();
		const oversizedRootCount = MAX_AGENT_TRUSTED_ROOTS + 1;
		const rawRoots = JSON.stringify(createRoots(oversizedRootCount, rootPath));
		const expectedMessage = `ZEROBYTE_AGENT_ROOTS must contain at most ${MAX_AGENT_TRUSTED_ROOTS} roots`;

		expect(() => parseConfiguredRoots(rawRoots)).toThrow(expectedMessage);
	});

	test.each([
		["malformed JSON", "[", "ZEROBYTE_AGENT_ROOTS must be valid JSON"],
		["a root without a path", '[{"id":"data","label":"Data"}]', "Invalid ZEROBYTE_AGENT_ROOTS"],
	])("rejects environment roots with %s", (_name, rawRoots, expectedMessage) => {
		expect(() => parseConfiguredRoots(rawRoots)).toThrow(expectedMessage);
	});

	test("defaults environment roots to allow backups", () => {
		expect(parseConfiguredRoots('[{"id":"data","label":"Data","path":"/"}]')).toEqual([
			{ id: "data", label: "Data", path: "/", allowBackup: true },
		]);
	});

	test("advertises descriptors without revealing canonical host paths", () => {
		const rootPath = createTemporaryDirectory();
		const roots = [{ id: "home", label: "Home", path: rootPath, allowBackup: true }];
		const registry = createTrustedRootRegistry({ roots });

		expect(getTrustedRootDescriptors(registry)).toEqual([{ id: "home", label: "Home", canBackup: true }]);
		expect(JSON.stringify(getTrustedRootDescriptors(registry))).not.toContain(rootPath);
	});

	test.each([
		[
			"duplicate ID",
			[
				{ id: "data", label: "One", path: "/", allowBackup: true },
				{ id: "data", label: "Two", path: "/", allowBackup: true },
			],
			"duplicate id",
		],
		[
			"duplicate label",
			[
				{ id: "one", label: "Data", path: "/", allowBackup: true },
				{ id: "two", label: "data", path: "/", allowBackup: true },
			],
			"duplicate label",
		],
	])("rejects %s", (_name, roots, expectedMessage) => {
		expect(() => createTrustedRootRegistry({ roots })).toThrow(expectedMessage);
	});

	test.each([
		["standalone without configuration", undefined, false, []],
		["standalone with an empty configuration", [], false, []],
		["built-in without configuration", undefined, true, [LOCAL_FILESYSTEM_ROOT_ID]],
		["built-in with an empty configuration", [], true, [LOCAL_FILESYSTEM_ROOT_ID]],
	])("models %s", (_name, roots, builtinLocal, expectedIds) => {
		const registry = createTrustedRootRegistry({ roots, builtinLocal });
		const rootIds = getTrustedRootDescriptors(registry).map((root) => root.id);

		expect(rootIds).toEqual(expectedIds);
	});

	test("configured roots cannot replace the built-in filesystem root", () => {
		const roots = [{ id: LOCAL_FILESYSTEM_ROOT_ID, label: "Replacement", path: "/", allowBackup: true }];

		expect(() => createTrustedRootRegistry({ roots, builtinLocal: true })).toThrow("duplicate id");
	});

	test("counts the built-in root toward the advertised root limit", () => {
		const rootPath = createTemporaryDirectory();
		const roots = createRoots(MAX_AGENT_TRUSTED_ROOTS - 1, rootPath);

		expect(createTrustedRootRegistry({ roots, builtinLocal: true }).size).toBe(MAX_AGENT_TRUSTED_ROOTS);
		expect(() =>
			createTrustedRootRegistry({
				roots: createRoots(MAX_AGENT_TRUSTED_ROOTS, rootPath),
				builtinLocal: true,
			}),
		).toThrow("including its built-in root");
	});

	test("does not grant an implicit root to a separately installed agent", () => {
		const registry = createTrustedRootRegistry();
		expect(getTrustedRootDescriptors(registry)).toEqual([]);
	});

	test("registers distinct built-in roots for every available Windows drive", () => {
		vi.stubGlobal("process", { ...process, platform: "win32" });
		vi.spyOn(fs, "existsSync").mockImplementation((rootPath) => rootPath === "C:\\" || rootPath === "D:\\");
		vi.spyOn(path, "resolve").mockImplementation(path.win32.resolve);
		vi.spyOn(fs.realpathSync, "native").mockImplementation((rootPath) => String(rootPath));
		vi.spyOn(fs, "statSync").mockReturnValue(fromPartial<fs.Stats>({ isDirectory: () => true }));

		const registry = createTrustedRootRegistry({ builtinLocal: true });

		expect(getTrustedRootDescriptors(registry)).toEqual([
			{ id: "local-filesystem-c", label: "Local filesystem (C:)", canBackup: true },
			{ id: "local-filesystem-d", label: "Local filesystem (D:)", canBackup: true },
		]);
		expect(registry.get("local-filesystem-c")?.canonicalPath).toBe("C:\\");
		expect(registry.get("local-filesystem-d")?.canonicalPath).toBe("D:\\");
	});

	test.each(["realpath", "stat"])(
		"an unavailable Windows drive with a failing %s does not block ready drives",
		(operation) => {
			vi.stubGlobal("process", { ...process, platform: "win32" });
			vi.spyOn(fs, "existsSync").mockImplementation((rootPath) => rootPath === "C:\\" || rootPath === "D:\\");
			vi.spyOn(path, "resolve").mockImplementation(path.win32.resolve);
			vi.spyOn(fs.realpathSync, "native").mockImplementation((rootPath) => {
				if (operation === "realpath" && rootPath === "D:\\") throw new Error("Drive unavailable");

				return String(rootPath);
			});
			vi.spyOn(fs, "statSync").mockImplementation((rootPath) => {
				if (operation === "stat" && rootPath === "D:\\") throw new Error("Drive unavailable");

				return fromPartial<fs.Stats>({ isDirectory: () => true });
			});

			const registry = createTrustedRootRegistry({ builtinLocal: true });

			expect(getTrustedRootDescriptors(registry)).toEqual([
				{ id: "local-filesystem-c", label: "Local filesystem (C:)", canBackup: true },
			]);
			expect(() =>
				createTrustedRootRegistry({
					builtinLocal: true,
					roots: [{ id: "required", label: "Required data", path: "D:\\", allowBackup: true }],
				}),
			).toThrow("Drive unavailable");
		},
	);

	test("grants an implicit whole-filesystem root to the built-in local agent", () => {
		const registry = createTrustedRootRegistry({ builtinLocal: true });
		const descriptors = getTrustedRootDescriptors(registry);
		expect(descriptors).toEqual([
			{
				id: LOCAL_FILESYSTEM_ROOT_ID,
				label: "Local filesystem",
				canBackup: true,
			},
		]);
	});

	test("extra built-in roots preserve the local filesystem root for managed volumes", () => {
		const rootPath = createTemporaryDirectory();
		const roots = [{ id: "data", label: "Data", path: rootPath, allowBackup: true }];
		const registry = createTrustedRootRegistry({ roots, builtinLocal: true });
		const descriptors = getTrustedRootDescriptors(registry);
		expect(descriptors.map((root) => root.id)).toEqual([LOCAL_FILESYSTEM_ROOT_ID, "data"]);
	});

	test.each([false, true])("disabled roots cannot resolve sources, builtinLocal=%s", async (builtinLocal) => {
		const rootPath = createTemporaryDirectory();
		const roots = [{ id: "data", label: "Data", path: rootPath, allowBackup: false }];
		const registry = createTrustedRootRegistry({ roots, builtinLocal });

		expect(getTrustedRootDescriptors(registry)).toContainEqual({ id: "data", label: "Data", canBackup: false });
		await expect(resolveFilesystemSource(registry, { rootId: "data", relativePath: "" })).rejects.toThrow(
			"does not allow backups",
		);
	});
});

describe("trusted source resolution", () => {
	test("resolves nested directories inside their canonical root", async () => {
		const rootPath = createTemporaryDirectory();
		const nestedPath = path.join(rootPath, "photos", "2026");
		fs.mkdirSync(nestedPath, { recursive: true });
		const roots = [{ id: "data", label: "Data", path: rootPath, allowBackup: true }];
		const registry = createTrustedRootRegistry({ roots });

		const resolved = await resolveFilesystemSource(registry, { rootId: "data", relativePath: "photos/2026" });
		expect(resolved.canonicalPath).toBe(fs.realpathSync.native(nestedPath));
	});

	test.each(["../outside", "nested/../../outside", "/etc", "C:\\Windows", "nested\\outside", "nested\0outside"])(
		"rejects path escape %j",
		(relativePath) => {
			expect(() => normalizeTrustedRelativePath(relativePath)).toThrow();
		},
	);

	test("rejects unknown root IDs", async () => {
		const registry = createTrustedRootRegistry();
		await expect(resolveFilesystemSource(registry, { rootId: "missing", relativePath: "" })).rejects.toThrow(
			'Unknown trusted root "missing"',
		);
	});

	test("rejects symlinks that escape the canonical root", async () => {
		const rootPath = createTemporaryDirectory();
		const outsidePath = createTemporaryDirectory();
		fs.symlinkSync(outsidePath, path.join(rootPath, "escape"));
		const roots = [{ id: "data", label: "Data", path: rootPath, allowBackup: true }];
		const registry = createTrustedRootRegistry({ roots });

		await expect(resolveFilesystemSource(registry, { rootId: "data", relativePath: "escape" })).rejects.toThrow(
			"through a symlink",
		);
	});
});
