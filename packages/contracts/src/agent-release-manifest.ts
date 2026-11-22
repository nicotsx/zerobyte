import { z } from "zod";

export const AGENT_RELEASE_ATTESTATION_ASSET = "zerobyte-agent.sigstore.json";
export const AGENT_RELEASE_ATTESTATION_MAX_BYTES = 64 * 1024;
export const AGENT_RELEASE_PREDICATE_TYPE = "https://zerobyte.app/attestation/agent-release/v1";

export const AGENT_RELEASE_EXECUTABLES = {
	x64: "zerobyte-agent-linux-x64",
	arm64: "zerobyte-agent-linux-arm64",
} as const;

export const agentReleaseTagSchema = z
	.string()
	.max(129)
	.regex(
		/^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
	);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const agentReleaseManifestSchema = z.strictObject({
	formatVersion: z.literal(1),
	tag: agentReleaseTagSchema,
	protocolVersion: z.int().positive(),
	sha256: z.strictObject({ x64: sha256Schema, arm64: sha256Schema }),
});

export type AgentReleaseManifest = z.infer<typeof agentReleaseManifestSchema>;

const releaseAssetSchema = z.enum([
	AGENT_RELEASE_ATTESTATION_ASSET,
	AGENT_RELEASE_EXECUTABLES.x64,
	AGENT_RELEASE_EXECUTABLES.arm64,
]);

const AGENT_RELEASE_BASE_URL = "https://zerobyte.app/agent/";

export function agentReleaseAssetUrl(tag: string, asset: z.infer<typeof releaseAssetSchema>): URL {
	return new URL(
		`${AGENT_RELEASE_BASE_URL}${encodeURIComponent(agentReleaseTagSchema.parse(tag))}/${releaseAssetSchema.parse(asset)}`,
	);
}

export async function fetchAgentReleaseAsset(url: URL, signal: AbortSignal): Promise<Response> {
	if (!url.href.startsWith(AGENT_RELEASE_BASE_URL)) throw new Error("Invalid agent release asset URL");

	const githubPath = `/nicotsx/zerobyte/releases/download/${url.pathname.slice("/agent/".length)}`;

	for (let redirects = 0; redirects <= 2; redirects++) {
		signal.throwIfAborted();
		const response = await fetch(url, { redirect: "manual", signal, tls: { rejectUnauthorized: true } });
		if (![301, 302, 303, 307, 308].includes(response.status)) return response;

		void response.body?.cancel().catch(() => {});
		const location = response.headers.get("location");
		if (!location) break;

		const next = new URL(location, url);
		if (next.protocol !== "https:" || next.port || next.username || next.password) {
			break;
		}

		const toGitHub =
			url.hostname === "zerobyte.app" && next.hostname === "github.com" && next.pathname === githubPath;
		const toAssets = url.hostname === "github.com" && next.hostname === "release-assets.githubusercontent.com";
		if (!toGitHub && !toAssets) break;

		url = next;
	}

	throw new Error("Invalid agent release asset redirect");
}

const releaseStatementSchema = z.object({
	_type: z.literal("https://in-toto.io/Statement/v1"),
	subject: z.array(z.object({ name: z.string(), digest: z.object({ sha256: sha256Schema }) })).length(2),
	predicateType: z.literal(AGENT_RELEASE_PREDICATE_TYPE),
	predicate: z.strictObject({
		tag: agentReleaseTagSchema,
		protocolVersion: agentReleaseManifestSchema.shape.protocolVersion,
	}),
});

export function parseAgentReleaseStatement(payload: Uint8Array, expectedTag: string): AgentReleaseManifest {
	const statement = releaseStatementSchema.parse(
		JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)),
	);
	const { tag, protocolVersion } = statement.predicate;
	if (tag !== expectedTag) {
		throw new Error(`Agent release attestation tag ${tag} does not match ${expectedTag}`);
	}

	const x64 = statement.subject.find(({ name }) => name === AGENT_RELEASE_EXECUTABLES.x64);
	const arm64 = statement.subject.find(({ name }) => name === AGENT_RELEASE_EXECUTABLES.arm64);
	if (!x64 || !arm64) throw new Error("Expected both Linux agent executables in the attestation");

	return { formatVersion: 1, tag, protocolVersion, sha256: { x64: x64.digest.sha256, arm64: arm64.digest.sha256 } };
}
