import { execFile, spawn } from "node:child_process";
import { Context, Data, Effect, Layer } from "effect";

export class CommandFailed extends Data.TaggedError("CommandFailed")<{ message: string; cause?: unknown }> {}

export class Host extends Context.Service<
	Host,
	{
		readonly output: (command: string, args: ReadonlyArray<string>) => Effect.Effect<string, CommandFailed>;
		readonly attach: (command: string, args: ReadonlyArray<string>) => Effect.Effect<void, CommandFailed>;
	}
>()("agent/Host") {}

const output = (command: string, args: ReadonlyArray<string>) =>
	Effect.callback<string, CommandFailed>((resume, signal) => {
		execFile(command, [...args], { encoding: "utf8", timeout: 60_000, signal }, (error, stdout, stderr) => {
			if (!error) return resume(Effect.succeed(stdout.trim()));

			const detail = stderr.trim() || error.message;
			resume(
				Effect.fail(
					new CommandFailed({ message: `${command} ${args.join(" ")} failed: ${detail}`, cause: error }),
				),
			);
		});
	});

const attach = (command: string, args: ReadonlyArray<string>) =>
	Effect.callback<void, CommandFailed>((resume) => {
		const child = spawn(command, [...args], { stdio: "inherit" });

		child.once("error", (error) => {
			resume(
				Effect.fail(new CommandFailed({ message: `Could not run ${command}: ${error.message}`, cause: error })),
			);
		});

		child.once("exit", (code, signal) => {
			if (code === 0 || signal === "SIGINT") return resume(Effect.void);
			resume(
				Effect.fail(new CommandFailed({ message: `${command} failed. Try running this command with sudo.` })),
			);
		});

		return Effect.sync(() => child.kill());
	});

export const HostLive = Layer.succeed(Host, Host.of({ output, attach }));
