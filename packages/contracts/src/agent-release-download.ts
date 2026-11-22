import { Cause, Data, Effect, Stream } from "effect";
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

export const streamAgentReleaseAsset = (url: URL, maxBytes: number) =>
	Stream.unwrap(
		Effect.gen(function* () {
			if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
				return yield* new ReleaseVerificationError({ cause: "Invalid release asset size limit" });
			}

			const controller = new AbortController();
			let body: ReadableStream<Uint8Array> | null = null;
			let reader: Pick<ReadableStreamDefaultReader<Uint8Array>, "cancel" | "releaseLock"> | undefined;
			let finished = false;

			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					controller.abort();

					// Cancellation may stall, so release the lock without waiting for it.
					if (!finished) void (reader ?? body)?.cancel().catch(() => {});
					reader?.releaseLock();
				}),
			);

			const { response, stream } = yield* Effect.tryPromise({
				try: async () => {
					const response = await fetchAgentReleaseAsset(url, controller.signal);
					if (controller.signal.aborted) {
						void response.body?.cancel().catch(() => {});
						controller.signal.throwIfAborted();
					}

					const stream: ReadableStream<Uint8Array> | null = response.body;
					body = stream;
					return { response, stream };
				},
				catch: (cause) => new ReleaseNetworkError({ cause }),
			});

			if (response.status === 404 || response.status === 410) return yield* new ReleaseAssetMissing({ url });
			if (!response.ok)
				return yield* new ReleaseNetworkError({ cause: `HTTP ${response.status} for ${url.href}` });
			if (!stream || Number(response.headers.get("content-length")) > maxBytes) {
				return yield* new ReleaseVerificationError({ cause: "Missing body or invalid release asset size" });
			}

			const activeReader = yield* Effect.try({
				try: () => {
					const acquired = stream.getReader();
					reader = acquired;
					return acquired;
				},
				catch: (cause) => new ReleaseNetworkError({ cause }),
			});
			let length = 0;

			return Stream.fromPull(
				Effect.succeed(
					Effect.gen(function* () {
						const chunk = yield* Effect.tryPromise({
							try: () => activeReader.read(),
							catch: (cause) => new ReleaseNetworkError({ cause }),
						});
						if (chunk.done) {
							finished = true;
							return yield* Cause.done();
						}

						length += chunk.value.byteLength;
						if (length > maxBytes) {
							return yield* new ReleaseVerificationError({ cause: "Release asset exceeds size limit" });
						}

						return [chunk.value] as const;
					}),
				),
			);
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
