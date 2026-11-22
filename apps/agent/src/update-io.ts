import { Data, Effect } from "effect";

export class UpdateIOError extends Data.TaggedError("UpdateIOError")<{
	message: string;
	cause?: unknown;
}> {}

export const updateIO = <A>(message: string, run: (signal: AbortSignal) => Promise<A>) =>
	Effect.tryPromise({ try: run, catch: (cause) => new UpdateIOError({ message, cause }) });
