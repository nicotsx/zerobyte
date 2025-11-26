import { spawn } from "node:child_process";

interface Params {
	command: string;
	args: string[];
	env?: NodeJS.ProcessEnv;
	signal?: AbortSignal;
	onStdout?: (data: string) => void;
	onStderr?: (error: string) => void;
	onError?: (error: Error) => Promise<void> | void;
	onClose?: (code: number | null) => Promise<void> | void;
	finally?: () => Promise<void> | void;
}

type SpawnResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export const safeSpawn = (params: Params) => {
	const { command, args, env = {}, signal, ...callbacks } = params;

	return new Promise<SpawnResult>((resolve) => {
		let stdoutData = "";
		let stderrData = "";

		const child = spawn(command, args, {
			env: { ...process.env, ...env },
			signal: signal,
		});

		child.stdout.on("data", (data) => {
			if (callbacks.onStdout) {
				callbacks.onStdout(data.toString());
			} else {
				stdoutData += data.toString();
			}
		});

		child.stderr.on("data", (data) => {
			if (callbacks.onStderr) {
				callbacks.onStderr(data.toString());
			}
			stderrData += data.toString();
		});

		child.on("error", async (error) => {
			if (callbacks.onError) {
				await callbacks.onError(error);
			}
			if (callbacks.finally) {
				await callbacks.finally();
			}

			resolve({
				exitCode: -1,
				stdout: stdoutData,
				stderr: stderrData,
			});
		});

		child.on("close", async (code) => {
			if (callbacks.onClose) {
				await callbacks.onClose(code);
			}
			if (callbacks.finally) {
				await callbacks.finally();
			}

			resolve({
				exitCode: code === null ? -1 : code,
				stdout: stdoutData,
				stderr: stderrData,
			});
		});
	});
};
