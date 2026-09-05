import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { Deferred, Effect, Option } from "effect";
import { logger } from "@zerobyte/core/node";
import { config } from "../../../core/config";
import { deriveLocalAgentToken } from "../helpers/tokens";

type LocalAgentState = { localAgent: ChildProcess | null };

const observeLocalAgentExit = (child: ChildProcess, resume: (result: Effect.Effect<void, Error>) => void) => {
	const cleanup = () => {
		child.off("exit", finish);
		child.off("close", finish);
		child.off("error", fail);
	};
	const finish = (code: number | null, signal: NodeJS.Signals | null) => {
		cleanup();
		logger.info(`Agent process exited with code ${code} and signal ${signal}`);
		resume(Effect.void);
	};
	const fail = (error: Error) => {
		cleanup();
		resume(Effect.fail(error));
	};

	if (child.exitCode !== null || child.signalCode !== null) {
		resume(Effect.void);
	} else {
		child.once("exit", finish);
		child.once("close", finish);
		child.once("error", fail);
	}

	return cleanup;
};

export const waitForLocalAgentExit = (child: ChildProcess) =>
	Effect.async<void, Error>((resume) => Effect.sync(observeLocalAgentExit(child, resume)));

export const stopLocalAgentProcess = (child: ChildProcess, exited = waitForLocalAgentExit(child)) =>
	Effect.gen(function* () {
		if (child.exitCode !== null || child.signalCode !== null) {
			yield* Effect.sync(() => signalAgent(child, "SIGKILL"));
			return;
		}

		yield* Effect.sync(() => signalAgent(child));
		const gracefulExit = yield* exited.pipe(Effect.interruptible, Effect.timeoutOption(5_000));
		if (Option.isNone(gracefulExit)) {
			yield* logger.effect.warn("Local agent did not stop gracefully; forcing shutdown");
		}

		yield* Effect.sync(() => signalAgent(child, "SIGKILL"));
		if (Option.isNone(gracefulExit)) {
			yield* exited.pipe(
				Effect.interruptible,
				Effect.timeoutFail({
					duration: 5_000,
					onTimeout: () => new Error("Local agent termination was not confirmed after SIGKILL"),
				}),
			);
		}
	});

export const spawnLocalAgentProcess = (runtime: LocalAgentState, controllerUrl: string) =>
	Effect.gen(function* () {
		const sourceEntryPoint = path.join(process.cwd(), "apps", "agent", "src", "index.ts");
		const productionEntryPoint = path.join(process.cwd(), ".output", "agent", "index.mjs");

		if (config.__prod__ && !existsSync(productionEntryPoint)) {
			return yield* Effect.fail(new Error(`Local agent entrypoint not found at ${productionEntryPoint}`));
		}

		const agentEntryPoint = config.__prod__ ? productionEntryPoint : sourceEntryPoint;
		const agentToken = yield* Effect.tryPromise({
			try: () => deriveLocalAgentToken(),
			catch: (error) => (error instanceof Error ? error : new Error(String(error))),
		});
		const exited = yield* Deferred.make<void, Error>();
		const args = config.__prod__ ? ["run", agentEntryPoint] : ["run", "--watch", agentEntryPoint];

		yield* Effect.acquireRelease(
			Effect.sync(() => {
				const child = spawn("bun", args, {
					env: {
						...process.env,
						ZEROBYTE_CONTROLLER_URL: controllerUrl,
						ZEROBYTE_AGENT_TOKEN: agentToken,
						ZEROBYTE_BUILTIN_LOCAL_AGENT: "1",
					},
					stdio: ["pipe", "pipe", "pipe"],
					detached: process.platform !== "win32",
				});
				runtime.localAgent = child;

				child.stdout?.on("data", (data: Buffer) => {
					const line = data.toString().trim();
					if (line) logger.info(`[agent] ${line}`);
				});

				child.stderr?.on("data", (data: Buffer) => {
					const line = data.toString().trim();
					if (line) logger.error(`[agent] ${line}`);
				});

				observeLocalAgentExit(child, (result) => Deferred.unsafeDone(exited, result));

				return child;
			}),
			(child) =>
				stopLocalAgentProcess(child, Deferred.await(exited)).pipe(
					Effect.tap(() =>
						Effect.sync(() => {
							if (runtime.localAgent === child) runtime.localAgent = null;
						}),
					),
					Effect.orDie,
				),
		);

		return { exited: Deferred.await(exited) };
	});

function signalAgent(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") {
	if (child.pid && process.platform !== "win32") {
		try {
			process.kill(-child.pid, signal);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		}
		return;
	}

	if (child.exitCode !== null || child.signalCode !== null) return;
	if (child.pid && process.platform === "win32") {
		execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, (error) => {
			if (error && child.exitCode === null && child.signalCode === null) child.kill(signal);
		});
		return;
	}

	if (signal === "SIGTERM") child.kill();
	else child.kill(signal);
}
