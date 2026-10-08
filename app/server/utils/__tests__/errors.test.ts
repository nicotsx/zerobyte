import { Effect } from "effect";
import { expect, test } from "vitest";
import { runEffectPromise } from "../errors";

test("preserves a typed Effect failure", async () => {
	const error = new Error("Command failed");

	await expect(runEffectPromise(Effect.fail(error))).rejects.toBe(error);
});

test("preserves cancellation after cleanup even when expected failures are captured", async () => {
	const controller = new AbortController();
	const reason = new Error("Request cancelled");
	const started = Promise.withResolvers<void>();
	let released = false;
	const effect = Effect.sync(() => started.resolve()).pipe(
		Effect.andThen(Effect.never),
		Effect.ensuring(
			Effect.sync(() => {
				released = true;
			}),
		),
		Effect.either,
	);

	const result = runEffectPromise(effect, { signal: controller.signal });
	const rejection = expect(result).rejects.toBe(reason);
	await started.promise;
	controller.abort(reason);
	await rejection;

	expect(released).toBe(true);
});
