import { Cause, Data, Effect, Stream } from "effect";

class HttpTransportError extends Data.TaggedError("HttpTransportError")<{ cause: unknown }> {}
class InvalidHttpBody extends Data.TaggedError("InvalidHttpBody")<{ message: string }> {}

export const fetchScopedHttpResponse = (fetchResponse: (signal: AbortSignal) => Promise<Response>, maxBytes: number) =>
	Effect.gen(function* () {
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
			return yield* new InvalidHttpBody({ message: "Invalid response size limit" });
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

		const response = yield* Effect.tryPromise({
			try: async () => {
				const response = await fetchResponse(controller.signal);
				if (controller.signal.aborted) {
					void response.body?.cancel().catch(() => {});
					controller.signal.throwIfAborted();
				}

				body = response.body;
				return response;
			},
			catch: (cause) => new HttpTransportError({ cause }),
		});

		const stream = Stream.unwrap(
			Effect.gen(function* () {
				const readable = body;
				if (!readable || Number(response.headers.get("content-length")) > maxBytes) {
					return yield* new InvalidHttpBody({ message: "Missing body or invalid response size" });
				}
				if (reader) return yield* new InvalidHttpBody({ message: "Response body already opened" });

				const activeReader = yield* Effect.try({
					try: () => {
						const acquired = readable.getReader();
						reader = acquired;
						return acquired;
					},
					catch: (cause) => new HttpTransportError({ cause }),
				});
				let length = 0;

				return Stream.fromPull(
					Effect.succeed(
						Effect.gen(function* () {
							const chunk = yield* Effect.tryPromise({
								try: () => activeReader.read(),
								catch: (cause) => new HttpTransportError({ cause }),
							});
							if (chunk.done) {
								finished = true;
								return yield* Cause.done();
							}

							length += chunk.value.byteLength;
							if (length > maxBytes) {
								return yield* new InvalidHttpBody({ message: "Response body exceeds size limit" });
							}

							return [chunk.value] as const;
						}),
					),
				);
			}),
		);

		return { response, body: stream };
	});
