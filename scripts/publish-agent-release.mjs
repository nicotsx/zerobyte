import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const assetNames = [
	"zerobyte-agent-linux-x64",
	"zerobyte-agent-linux-x64.sha256",
	"zerobyte-agent-linux-x64.LICENSE.txt",
	"zerobyte-agent-linux-arm64",
	"zerobyte-agent-linux-arm64.sha256",
	"zerobyte-agent-linux-arm64.LICENSE.txt",
	"zerobyte-agent.sigstore.json",
];

function matchesAsset(asset, digest) {
	return asset?.state === "uploaded" && asset.digest === digest;
}

export async function publishAgentRelease({ github, repo, tag, prerelease, directory }) {
	for (const name of assetNames) {
		const file = await stat(join(directory, name));
		if (!file.isFile() || file.size === 0) {
			throw new Error(`Release asset ${name} must be a nonempty file`);
		}
	}

	const { repos } = github.rest;
	const releases = await github.paginate(repos.listReleases, { ...repo, per_page: 100 });
	const matchingReleases = releases.filter((release) => release.tag_name === tag);
	if (matchingReleases.length > 1) {
		throw new Error(`Multiple releases match ${tag}`);
	}

	let [release] = matchingReleases;
	if (!release) {
		const notes =
			"Desktop apps are still in alpha state and are not yet officially supported. Please report any issues you encounter.";
		({ data: release } = await repos.createRelease({
			...repo,
			tag_name: tag,
			name: tag,
			body: `**${tag}**\n\n${notes}`,
			draft: true,
			prerelease,
			make_latest: "false",
		}));
	}

	const releaseParams = { ...repo, release_id: release.id };
	const assets = await github.paginate(repos.listReleaseAssets, { ...releaseParams, per_page: 100 });
	const assetsByName = new Map(assets.map((asset) => [asset.name, asset]));

	for (const name of assetNames) {
		const data = await readFile(join(directory, name));
		const digest = `sha256:${createHash("sha256").update(data).digest("hex")}`;
		const asset = assetsByName.get(name);
		if (matchesAsset(asset, digest)) continue;

		if (!release.draft) {
			throw new Error(`Published release ${tag} is missing ${name} or its digest differs`);
		}

		if (asset) {
			await repos.deleteReleaseAsset({ ...repo, asset_id: asset.id });
		}

		const { data: uploaded } = await repos.uploadReleaseAsset({
			...releaseParams,
			name,
			data,
			headers: { "content-type": "application/octet-stream", "content-length": data.length },
		});
		if (uploaded.name !== name || !matchesAsset(uploaded, digest)) {
			throw new Error(`GitHub could not verify the uploaded release asset ${name}`);
		}
	}

	if (release.draft) {
		await repos.updateRelease({ ...releaseParams, draft: false, prerelease, make_latest: "false" });
	}

	return release.id;
}
