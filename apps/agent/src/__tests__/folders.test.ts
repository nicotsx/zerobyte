import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_AGENT_TRUSTED_ROOTS } from "@zerobyte/contracts/agent-protocol";
import { afterEach, expect, test } from "vitest";
import { addFolders, listFolders } from "../folders";
import { runTest } from "./effect-test-support";

const temporary: string[] = [];

afterEach(async () => {
	await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const setup = async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "zerobyte-folders-")));
	temporary.push(directory);

	const config = join(directory, "agent.json");
	const first = join(directory, "first");
	const second = join(directory, "second");

	await writeFile(
		config,
		JSON.stringify({
			controllerUrl: "wss://controller.test/api/v1/agents/connect",
			token: "saved-identity",
			roots: [],
		}),
		{ mode: 0o600 },
	);
	await mkdir(first);
	await mkdir(second);

	const add = (paths: string[]) => runTest(addFolders(config, paths));
	const list = () => runTest(listFolders(config));
	const readSaved = async () => JSON.parse(await readFile(config, "utf8"));

	return { directory, config, first, second, add, list, readSaved };
};

test("folders added across commands keep earlier identities and the credential", async () => {
	const { config, first, second, add, list, readSaved } = await setup();

	await add([first]);
	const [original] = (await readSaved()).roots;
	await add([second]);

	const saved = await readSaved();
	expect(saved.roots[0]).toEqual(original);
	expect(saved.token).toBe("saved-identity");
	expect(await list()).toEqual([
		{ label: "first", path: first },
		{ label: "second", path: second },
	]);
	expect((await stat(config)).mode & 0o777).toBe(0o600);
});

test("multiple selections and symlink aliases do not duplicate shared folders", async () => {
	const { directory, first, second, add, list } = await setup();
	const alias = join(directory, "alias");
	await symlink(first, alias);

	await add([first, second, alias]);

	expect(await list()).toHaveLength(2);
	expect(await add([alias, first])).toEqual([]);
});

test("an invalid selection leaves the configuration unchanged", async () => {
	const { config, directory, first, add } = await setup();
	const file = join(directory, "file");
	await writeFile(file, "not a directory");
	const original = await readFile(config, "utf8");

	await expect(add([first, join(directory, "missing")])).rejects.toThrow();
	await expect(add([first, file])).rejects.toThrow("not a directory");
	expect(await readFile(config, "utf8")).toBe(original);
	expect(await readdir(directory)).toEqual(expect.not.arrayContaining([expect.stringMatching(/\.tmp$/)]));
});

test("labels stay unique next to an unavailable saved root", async () => {
	const { config, first, second, add, readSaved } = await setup();
	const roots = [{ id: "saved-root", label: "second", path: first, allowBackup: false }];
	await writeFile(config, JSON.stringify({ ...(await readSaved()), roots }));
	await rm(first, { recursive: true });

	expect(await add([second])).toEqual([second]);
	expect((await readSaved()).roots).toEqual([
		...roots,
		{ id: expect.any(String), label: "second (2)", path: second, allowBackup: true },
	]);
});

test("the configured root limit is enforced before saving", async () => {
	const { config, first, second, add, readSaved } = await setup();
	const roots = Array.from({ length: MAX_AGENT_TRUSTED_ROOTS }, (_, index) => ({
		id: `root-${index}`,
		label: `Root ${index}`,
		path: first,
	}));
	await writeFile(config, JSON.stringify({ ...(await readSaved()), roots }));
	const original = await readFile(config, "utf8");

	await expect(add([second])).rejects.toThrow("at most");
	expect(await readFile(config, "utf8")).toBe(original);
});
