import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { MAX_AGENT_TRUSTED_ROOTS } from "@zerobyte/contracts/agent-protocol";
import {
	BUILTIN_COMPATIBILITY_ROOT_ID,
	createTrustedRootRegistry,
	getTrustedRootDescriptors,
	normalizeTrustedRelativePath,
	resolveTrustedSourcePath,
} from "../trusted-roots";
import { createAgentExecutionPolicy } from "../execution-policy";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = () => {
	const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-trusted-root-"));
	temporaryDirectories.push(temporaryDirectory);
	return temporaryDirectory;
};

const createRawRoots = (count: number, rootPath: string) => {
	const roots = Array.from({ length: count }, (_value, index) => ({
		id: `root-${index}`,
		label: `Root ${index}`,
		path: rootPath,
	}));
	return JSON.stringify(roots);
};

afterEach(() => {
	for (const temporaryDirectory of temporaryDirectories.splice(0)) {
		fs.rmSync(temporaryDirectory, { recursive: true, force: true });
	}
});

describe("trusted root configuration", () => {
	test("accepts the maximum number of configured roots", () => {
		const rootPath = createTemporaryDirectory();
		const rawRoots = createRawRoots(MAX_AGENT_TRUSTED_ROOTS, rootPath);
		const registry = createTrustedRootRegistry({ rawRoots });

		expect(registry.size).toBe(MAX_AGENT_TRUSTED_ROOTS);
	});

	test("rejects configurations above the maximum number of roots", () => {
		const rootPath = createTemporaryDirectory();
		const oversizedRootCount = MAX_AGENT_TRUSTED_ROOTS + 1;
		const rawRoots = createRawRoots(oversizedRootCount, rootPath);
		const expectedMessage = `ZEROBYTE_AGENT_ROOTS must contain at most ${MAX_AGENT_TRUSTED_ROOTS} roots`;

		expect(() => createTrustedRootRegistry({ rawRoots })).toThrow(expectedMessage);
	});

	test("advertises descriptors without revealing canonical host paths", () => {
		const rootPath = createTemporaryDirectory();
		const rawRoots = JSON.stringify([{ id: "home", label: "Home", path: rootPath }]);
		const registry = createTrustedRootRegistry({ rawRoots });

		expect(getTrustedRootDescriptors(registry)).toEqual([{ id: "home", label: "Home", canBackup: true }]);
		expect(JSON.stringify(getTrustedRootDescriptors(registry))).not.toContain(rootPath);
	});

	test.each([
		[
			"duplicate ID",
			'[{"id":"data","label":"One","path":"/"},{"id":"data","label":"Two","path":"/"}]',
			"duplicate id",
		],
		[
			"duplicate label",
			'[{"id":"one","label":"Data","path":"/"},{"id":"two","label":"data","path":"/"}]',
			"duplicate label",
		],
	])("rejects %s", (_name, rawRoots, expectedMessage) => {
		expect(() => createTrustedRootRegistry({ rawRoots })).toThrow(expectedMessage);
	});

	test.each([
		["standalone without configuration", undefined, false, [], false],
		["standalone with an empty configuration", "[]", false, [], false],
		["built-in without configuration", undefined, true, [BUILTIN_COMPATIBILITY_ROOT_ID], true],
		["built-in with an empty configuration", "[]", true, [], false],
	])("models %s", (_name, rawRoots, builtinLocal, expectedIds, expectedImplicitCompatibility) => {
		const registry = createTrustedRootRegistry({ rawRoots, builtinLocal });
		const rootIds = getTrustedRootDescriptors(registry).map((root) => root.id);

		expect(rootIds).toEqual(expectedIds);
		expect(registry.hasImplicitBuiltinCompatibilityRoot).toBe(expectedImplicitCompatibility);
	});

	test("does not grant an implicit root to a separately installed agent", () => {
		const registry = createTrustedRootRegistry();
		expect(getTrustedRootDescriptors(registry)).toEqual([]);
	});

	test("grants an implicit whole-filesystem root to the built-in local agent", () => {
		const registry = createTrustedRootRegistry({ builtinLocal: true });
		const descriptors = getTrustedRootDescriptors(registry);
		expect(descriptors).toEqual([
			{
				id: BUILTIN_COMPATIBILITY_ROOT_ID,
				label: "Local filesystem",
				canBackup: true,
			},
		]);
	});

	test("explicit built-in roots replace the implicit compatibility root", () => {
		const rootPath = createTemporaryDirectory();
		const rawRoots = JSON.stringify([{ id: "data", label: "Data", path: rootPath }]);
		const registry = createTrustedRootRegistry({ rawRoots, builtinLocal: true });
		const descriptors = getTrustedRootDescriptors(registry);
		expect(descriptors.map((root) => root.id)).toEqual(["data"]);
		expect(registry.hasImplicitBuiltinCompatibilityRoot).toBe(false);
	});

	test("sanitizes standalone capabilities while retaining built-in compatibility capabilities", () => {
		const standaloneRegistry = createTrustedRootRegistry();
		const standalonePolicy = createAgentExecutionPolicy({ builtinLocal: false, registry: standaloneRegistry });
		const builtinRegistry = createTrustedRootRegistry({ builtinLocal: true });
		const builtinPolicy = createAgentExecutionPolicy({ builtinLocal: true, registry: builtinRegistry });

		expect(standalonePolicy.capabilities).toMatchObject({ backup: false, restore: false, volume: false });
		expect(builtinPolicy.capabilities).toMatchObject({ backup: true, restore: true, volume: true });
	});
});

describe("trusted source resolution", () => {
	test("resolves nested directories inside their canonical root", () => {
		const rootPath = createTemporaryDirectory();
		const nestedPath = path.join(rootPath, "photos", "2026");
		fs.mkdirSync(nestedPath, { recursive: true });
		const rawRoots = JSON.stringify([{ id: "data", label: "Data", path: rootPath }]);
		const registry = createTrustedRootRegistry({ rawRoots });

		const resolved = resolveTrustedSourcePath(registry, { rootId: "data", relativePath: "photos/2026" });
		expect(resolved.canonicalPath).toBe(fs.realpathSync.native(nestedPath));
	});

	test.each(["../outside", "nested/../../outside", "/etc", "C:\\Windows", "nested\\outside", "nested\0outside"])(
		"rejects path escape %j",
		(relativePath) => {
			expect(() => normalizeTrustedRelativePath(relativePath)).toThrow();
		},
	);

	test("rejects unknown root IDs", () => {
		const registry = createTrustedRootRegistry();
		expect(() => resolveTrustedSourcePath(registry, { rootId: "missing", relativePath: "" })).toThrow(
			'Unknown trusted root "missing"',
		);
	});

	test("rejects symlinks that escape the canonical root", () => {
		const rootPath = createTemporaryDirectory();
		const outsidePath = createTemporaryDirectory();
		fs.symlinkSync(outsidePath, path.join(rootPath, "escape"));
		const rawRoots = JSON.stringify([{ id: "data", label: "Data", path: rootPath }]);
		const registry = createTrustedRootRegistry({ rawRoots });

		expect(() => resolveTrustedSourcePath(registry, { rootId: "data", relativePath: "escape" })).toThrow(
			"through a symlink",
		);
	});
});
