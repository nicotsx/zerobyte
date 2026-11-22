import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { publishAgentRelease } from "../publish-agent-release.mjs";

const releaseAssets = [
	"zerobyte-agent-linux-x64",
	"zerobyte-agent-linux-x64.sha256",
	"zerobyte-agent-linux-x64.LICENSE.txt",
	"zerobyte-agent-linux-arm64",
	"zerobyte-agent-linux-arm64.sha256",
	"zerobyte-agent-linux-arm64.LICENSE.txt",
	"zerobyte-agent.sigstore.json",
];

async function setup(t, { prerelease = false, failUpload } = {}) {
	const directory = await mkdtemp(join(tmpdir(), "agent-release-publish-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	await Promise.all(releaseAssets.map((name) => writeFile(join(directory, name), name)));

	const tag = prerelease ? "v1.2.0-beta.1" : "v1.2.0";
	const assets = new Map();
	const releases = [];
	const mutations = [];
	let nextId = 1;
	let uploadInterrupted = false;
	const repos = {
		listReleases: () => releases,
		listReleaseAssets: () => [...assets.values()],
		async createRelease(fields) {
			const release = { ...fields, id: nextId++ };
			releases.push(release);
			mutations.push(["create", fields.draft]);
			return { data: release };
		},
		async uploadReleaseAsset({ name, data }) {
			assert.equal(releases[0].draft, true);
			assert.equal(assets.has(name), false);
			const asset = {
				id: nextId++,
				name,
				state: "uploaded",
				digest: `sha256:${createHash("sha256").update(data).digest("hex")}`,
			};
			mutations.push(["upload", name]);
			if (name === failUpload && !uploadInterrupted) {
				uploadInterrupted = true;
				assets.set(name, { id: asset.id, name, state: "starter" });
				throw new Error("GitHub upload interrupted");
			}
			assets.set(name, asset);
			return { data: asset };
		},
		async deleteReleaseAsset({ asset_id }) {
			assert.equal(releases[0].draft, true);
			const asset = [...assets.values()].find(({ id }) => id === asset_id);
			mutations.push(["delete", asset.name]);
			assets.delete(asset.name);
		},
		async updateRelease(fields) {
			assert.deepEqual(new Set(assets.keys()), new Set(releaseAssets));
			mutations.push(["publish"]);
			Object.assign(releases[0], fields);
		},
	};

	const github = { rest: { repos }, paginate: async (endpoint) => endpoint() };
	const publish = () =>
		publishAgentRelease({ github, repo: { owner: "nicotsx", repo: "zerobyte" }, tag, prerelease, directory });

	return { publish, releases, assets, mutations, directory };
}

for (const prerelease of [false, true]) {
	await test(`stages all assets before publishing a ${prerelease ? "prerelease" : "stable release"}`, async (t) => {
		const { publish, releases, mutations } = await setup(t, { prerelease });
		assert.equal(await publish(), releases[0].id);
		assert.deepEqual(mutations[0], ["create", true]);
		assert.deepEqual(mutations.at(-1), ["publish"]);
		assert.equal(releases[0].draft, false);
		assert.equal(releases[0].prerelease, prerelease);
		assert.equal(releases[0].make_latest, "false");
	});
}

await test("resumes a partial draft and replaces an interrupted upload", async (t) => {
	const manifest = "zerobyte-agent.sigstore.json";
	const { publish, releases, mutations } = await setup(t, { failUpload: manifest });

	await assert.rejects(publish(), /upload interrupted/);
	assert.equal(releases[0].draft, true);

	const before = mutations.length;
	assert.equal(await publish(), releases[0].id);
	assert.deepEqual(mutations.slice(before), [["delete", manifest], ["upload", manifest], ["publish"]]);
});

await test("checks a published bundle on rerun without changing it", async (t) => {
	const { publish, assets, mutations } = await setup(t);
	const id = await publish();
	const before = mutations.length;

	assert.equal(await publish(), id);
	assets.get("zerobyte-agent.sigstore.json").digest = "sha256:stale";
	await assert.rejects(publish(), /Published release .* digest differs/);
	assets.delete("zerobyte-agent.sigstore.json");
	await assert.rejects(publish(), /Published release .* is missing zerobyte-agent\.sigstore\.json/);
	assert.equal(mutations.length, before);
});

await test("rejects an empty asset before creating a draft", async (t) => {
	const { publish, directory, mutations } = await setup(t);
	await writeFile(join(directory, "zerobyte-agent.sigstore.json"), "");

	await assert.rejects(publish(), /zerobyte-agent\.sigstore\.json must be a nonempty file/);
	assert.deepEqual(mutations, []);
});
