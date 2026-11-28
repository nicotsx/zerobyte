import { Data, Effect, Stream } from "effect";
import { fetchScopedHttpResponse } from "@zerobyte/core/node";
import {
	AGENT_RELEASE_ATTESTATION_ASSET,
	AGENT_RELEASE_ATTESTATION_MAX_BYTES,
	agentReleaseAssetUrl,
	fetchAgentReleaseAsset,
	verifyAgentReleaseAttestation,
} from "./agent-release";

export class ReleaseNetworkError extends Data.TaggedError("ReleaseNetworkError")<{ cause: unknown }> {}
export class ReleaseAssetMissing extends Data.TaggedError("ReleaseAssetMissing")<{ url: URL }> {}
export class ReleaseVerificationError extends Data.TaggedError("ReleaseVerificationError")<{ cause: unknown }> {}

const RELEASE_TIMEOUT_MS = 30_000;

const toReleaseError = (error: Effect.Error<ReturnType<typeof fetchScopedHttpResponse>>) =>
	error._tag === "HttpTransportError"
		? new ReleaseNetworkError({ cause: error.cause })
		: new ReleaseVerificationError({ cause: error.message });

export const streamAgentReleaseAsset = (url: URL, maxBytes: number) =>
	Stream.unwrap(
		Effect.gen(function* () {
			const { response, body } = yield* fetchScopedHttpResponse(
				(signal) => fetchAgentReleaseAsset(url, signal),
				maxBytes,
			).pipe(Effect.mapError(toReleaseError));

			if (response.status === 404 || response.status === 410) return yield* new ReleaseAssetMissing({ url });
			if (!response.ok)
				return yield* new ReleaseNetworkError({ cause: `HTTP ${response.status} for ${url.href}` });

			return body.pipe(Stream.mapError(toReleaseError));
		}),
	);

const readReleaseAsset = (url: URL, maxBytes: number) =>
	streamAgentReleaseAsset(url, maxBytes).pipe(
		Stream.runFold(
			() => ({ bytes: new Uint8Array(maxBytes), length: 0 }),
			(asset, chunk) => {
				asset.bytes.set(chunk, asset.length);
				asset.length += chunk.byteLength;
				return asset;
			},
		),
		Effect.map(({ bytes, length }) => bytes.subarray(0, length)),
	);

export const downloadAgentRelease = (tag: string) =>
	Effect.gen(function* () {
		const url = yield* Effect.try({
			try: () => agentReleaseAssetUrl(tag, AGENT_RELEASE_ATTESTATION_ASSET),
			catch: (cause) => new ReleaseVerificationError({ cause }),
		});
		const bundle = yield* readReleaseAsset(url, AGENT_RELEASE_ATTESTATION_MAX_BYTES);

		return yield* verifyAgentReleaseAttestation(bundle, tag).pipe(
			Effect.mapError((error) => {
				if (error._tag === "AgentReleaseTrustUnavailable")
					return new ReleaseNetworkError({ cause: error.cause });
				return new ReleaseVerificationError({ cause: error.cause });
			}),
		);
	}).pipe(
		Effect.timeoutOrElse({
			duration: RELEASE_TIMEOUT_MS,
			orElse: () => Effect.fail(new ReleaseNetworkError({ cause: "Release attestation lookup timed out" })),
		}),
	);
