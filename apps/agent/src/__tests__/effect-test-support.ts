import { Cause, Effect, Exit, Layer } from "effect";
import { vi } from "vitest";
import { CommandFailed, Host } from "../host";

export const createTestHost = (resticVersion = "0.18.0") => {
	const output = vi.fn((command: string, args: ReadonlyArray<string>): Effect.Effect<string, CommandFailed> => {
		if (args[0] === "version")
			return Effect.succeed(`restic ${resticVersion} compiled with go1.24.0 on linux/amd64`);
		return Effect.succeed("");
	});
	const attach = vi.fn((_command: string, _args: ReadonlyArray<string>) => Effect.void);

	return { output, attach, layer: Layer.succeed(Host, Host.of({ output, attach })) };
};

export const commandFailure = (message: string) => Effect.fail(new CommandFailed({ message }));

export const runTest = async <A, E>(effect: Effect.Effect<A, E, Host>, host = createTestHost()) => {
	const exit = await Effect.runPromiseExit(Effect.provide(effect, host.layer));

	if (Exit.isSuccess(exit)) return exit.value;
	throw Cause.squash(exit.cause);
};
