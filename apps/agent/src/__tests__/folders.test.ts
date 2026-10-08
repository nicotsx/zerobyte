import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { addFolders, listFolders } from "../folders";
import { MAX_AGENT_TRUSTED_ROOTS } from "@zerobyte/contracts/agent-protocol";
import { createTrustedRootRegistry } from "../trusted-roots";

const temporary: string[] = [];
afterEach(async () => {
	await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const setup = async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "zerobyte-folders-")));
	temporary.push(directory);
	const config = join(directory, "agent.json");
	await writeFile(
		config,
		JSON.stringify({
			controllerUrl: "wss://controller.test/api/v1/agents/connect",
			token: "saved-identity",
			roots: "[]",
			allowInsecure: false,
		}),
		{ mode: 0o600 },
	);
	const first = join(directory, "first");
	const second = join(directory, "second");
	await mkdir(first);
	await mkdir(second);
	return { config, first, second, directory };
};
test("folders can be added across commands without changing earlier identities or credentials", async () => {
	const { config, first, second } = await setup();
	await addFolders(config, [first]);
	const original = (await listFolders(config))[0]!;
	await addFolders(config, [second]);
	const roots = await listFolders(config);
	expect(roots).toHaveLength(2);
	expect(roots[0]).toEqual(original);
	expect(roots[1]?.configuredPath).toBe(second);
	expect(JSON.parse(await readFile(config, "utf8")).token).toBe("saved-identity");
	expect((await stat(config)).mode & 0o777).toBe(0o600);
});
test("multiple selection and symlink aliases do not duplicate shared folders", async () => {
	const { config, first, second, directory } = await setup();
	const alias = join(directory, "alias");
	await symlink(first, alias);
	await addFolders(config, [first, second, alias]);
	expect(await listFolders(config)).toHaveLength(2);
	expect(await addFolders(config, [alias, first])).toEqual([]);
});
test("canceling or selecting an invalid folder leaves the configuration unchanged", async () => {
	const { config, first, directory } = await setup();
	const original = await readFile(config, "utf8");
	await addFolders(config, []);
	expect(await readFile(config, "utf8")).toBe(original);
	await expect(addFolders(config, [first, join(directory, "missing")])).rejects.toThrow();
	expect(await readFile(config, "utf8")).toBe(original);
});
test.each(["missing", "file", "broken symlink"])(
	"listing and adding preserve existing definitions for an unavailable root: %s",
	async (unavailable) => {
		const { config, first, second, directory } = await setup();
		const roots = [{ id: "saved-root", label: "second", path: `${first}/../first`, allowBackup: false }];
		const configuration = JSON.parse(await readFile(config, "utf8"));
		await writeFile(config, JSON.stringify({ ...configuration, roots: JSON.stringify(roots) }));
		await rm(first, { recursive: true });
		if (unavailable === "file") await writeFile(first, "not a directory");
		if (unavailable === "broken symlink") await symlink(join(directory, "missing"), first);

		expect(await listFolders(config)).toEqual([
			{ descriptor: { id: "saved-root", label: "second", canBackup: false }, configuredPath: first },
		]);
		expect(await addFolders(config, [second])).toEqual([second]);
		const saved = JSON.parse(await readFile(config, "utf8"));
		expect(saved).toEqual({ ...configuration, roots: expect.any(String) });
		expect(JSON.parse(saved.roots)).toEqual([
			...roots,
			{ id: expect.any(String), label: "second (2)", path: second, allowBackup: true },
		]);
		expect(() => createTrustedRootRegistry({ rawRoots: saved.roots })).toThrow();
	},
);

test("new selections must be directories even when an existing root is unavailable", async () => {
	const { config, first, second, directory } = await setup();
	await addFolders(config, [first]);
	await rm(first, { recursive: true });
	const file = join(directory, "file");
	await writeFile(file, "not a directory");
	const original = await readFile(config, "utf8");
	await expect(addFolders(config, [second, file])).rejects.toThrow("not a directory");
	expect(await readFile(config, "utf8")).toBe(original);
});

test("unavailable roots still count toward the configured root limit", async () => {
	const { config, first, second } = await setup();
	const configuration = JSON.parse(await readFile(config, "utf8"));
	const roots = Array.from({ length: MAX_AGENT_TRUSTED_ROOTS }, (_, index) => ({
		id: `root-${index}`,
		label: `Root ${index}`,
		path: first,
	}));
	await writeFile(config, JSON.stringify({ ...configuration, roots: JSON.stringify(roots) }));
	await rm(first, { recursive: true });
	const original = await readFile(config, "utf8");
	await expect(addFolders(config, [second])).rejects.toThrow("at most");
	expect(await readFile(config, "utf8")).toBe(original);
});

test("concurrent folder additions preserve both selections", async () => {
	const { config, first, second } = await setup();
	await Promise.all([addFolders(config, [first]), addFolders(config, [second])]);
	expect((await listFolders(config)).map((root) => root.configuredPath).sort()).toEqual([first, second].sort());
});
