import { bundleFromJSON, isBundleWithDsseEnvelope } from "@sigstore/bundle";
import { getTrustedRoot } from "@sigstore/tuf";
import {
	toSignedEntity,
	toTrustMaterial,
	Verifier,
	type ObjectIdentifierValuePair,
	type Signer,
} from "@sigstore/verify";
import { Utf8String } from "asn1js";
import { Cache, Data, Effect, Exit } from "effect";
import {
	AGENT_RELEASE_ATTESTATION_MAX_BYTES,
	agentReleaseTagSchema,
	parseAgentReleaseStatement,
} from "./agent-release-manifest";

export {
	AGENT_RELEASE_ATTESTATION_ASSET,
	AGENT_RELEASE_ATTESTATION_MAX_BYTES,
	AGENT_RELEASE_EXECUTABLES,
	AGENT_RELEASE_PREDICATE_TYPE,
	agentReleaseAssetUrl,
	agentReleaseManifestSchema,
	fetchAgentReleaseAsset,
	type AgentReleaseManifest,
} from "./agent-release-manifest";

export class AgentReleaseTrustUnavailable extends Data.TaggedError("AgentReleaseTrustUnavailable")<{
	cause: unknown;
}> {}
export class AgentAttestationInvalid extends Data.TaggedError("AgentAttestationInvalid")<{ cause: unknown }> {}

const releaseSignerWorkflow = "https://github.com/nicotsx/zerobyte/.github/workflows/attest-agent-release.yml";
const releaseRepositoryId = "1034918094";
const gitHubIssuer = "https://token.actions.githubusercontent.com";
const inTotoPayloadType = "application/vnd.in-toto+json";
const fulcioCertificateOids = {
	runnerEnvironment: "1.3.6.1.4.1.57264.1.11",
	sourceRepositoryDigest: "1.3.6.1.4.1.57264.1.13",
	sourceRepositoryRef: "1.3.6.1.4.1.57264.1.14",
	sourceRepositoryIdentifier: "1.3.6.1.4.1.57264.1.15",
};

let pendingTrustRefresh: Promise<Verifier> | undefined;

const trustedVerifier = Effect.runSync(
	Cache.makeWith(
		(_: "public-good") =>
			Effect.tryPromise({
				try: () => {
					// An interrupted caller can leave the TUF client writing to its cache.
					pendingTrustRefresh ??= getTrustedRoot({ timeout: 2_000, retry: 0 })
						.then((root) => new Verifier(toTrustMaterial(root)))
						.finally(() => {
							pendingTrustRefresh = undefined;
						});
					return pendingTrustRefresh;
				},
				catch: (cause) => new AgentReleaseTrustUnavailable({ cause }),
			}),
		{ capacity: 1, timeToLive: (exit) => (Exit.isSuccess(exit) ? "15 minutes" : "5 seconds") },
	),
);

function certificateExtension(oid: string, value: string): ObjectIdentifierValuePair {
	return {
		oid: { id: oid.split(".").map(Number) },
		value: Buffer.from(new Utf8String({ value }).toBER()),
	};
}

function isReleaseWorkflowSigner(identity: Signer["identity"], ref: string): boolean {
	const prefix = `${releaseSignerWorkflow}@`;
	const name = identity?.subjectAlternativeName;
	if (!name?.startsWith(prefix)) return false;

	const revision = name.slice(prefix.length);
	if (revision === ref) return true;
	if (!/^[a-f0-9]{40}$/.test(revision)) return false;

	const sourceCommit = certificateExtension(fulcioCertificateOids.sourceRepositoryDigest, revision);
	return (
		identity?.oids?.some((extension) => {
			return (
				extension.oid?.id.join(".") === fulcioCertificateOids.sourceRepositoryDigest &&
				Buffer.from(sourceCommit.value).equals(extension.value)
			);
		}) ?? false
	);
}

export function verifyAgentReleaseAttestation(bytes: Uint8Array, expectedTag: string) {
	return Effect.gen(function* () {
		const { bundle, dsseEnvelope, tag } = yield* Effect.try({
			try: () => {
				const tag = agentReleaseTagSchema.parse(expectedTag);
				if (bytes.byteLength > AGENT_RELEASE_ATTESTATION_MAX_BYTES) {
					throw new Error("Agent release attestation exceeds size limit");
				}

				const bundle = bundleFromJSON(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
				if (
					!isBundleWithDsseEnvelope(bundle) ||
					bundle.content.dsseEnvelope.payloadType !== inTotoPayloadType
				) {
					throw new Error("Expected an in-toto attestation envelope");
				}

				return { bundle, dsseEnvelope: bundle.content.dsseEnvelope, tag };
			},
			catch: (cause) => new AgentAttestationInvalid({ cause }),
		});

		const verifier = yield* Cache.get(trustedVerifier, "public-good");
		return yield* Effect.try({
			try: () => {
				const ref = `refs/tags/${tag}`;
				const signer = verifier.verify(toSignedEntity(bundle), {
					extensions: { issuer: gitHubIssuer },
					oids: [
						certificateExtension(fulcioCertificateOids.runnerEnvironment, "github-hosted"),
						certificateExtension(fulcioCertificateOids.sourceRepositoryRef, ref),
						certificateExtension(fulcioCertificateOids.sourceRepositoryIdentifier, releaseRepositoryId),
					],
				});
				if (!isReleaseWorkflowSigner(signer.identity, ref)) {
					throw new Error("Unexpected agent release signing workflow");
				}

				return parseAgentReleaseStatement(dsseEnvelope.payload, tag);
			},
			catch: (cause) => new AgentAttestationInvalid({ cause }),
		});
	});
}
