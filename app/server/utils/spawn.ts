import { spawn, execFile, type ExecException, type ExecFileOptions } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

type ExecProps = {
	command: string;
	args?: string[];
	env?: NodeJS.ProcessEnv;
} & ExecFileOptions;

export const exec = async ({ command, args = [], env = {}, ...rest }: ExecProps) => {
	const options = {
		env: { ...process.env, ...env },
	};

	try {
		const { stdout, stderr } = await promisify(execFile)(command, args, { ...options, ...rest, encoding: "utf8" });

		return { exitCode: 0, stdout, stderr };
	} catch (error) {
		const execError = error as ExecException;

		return {
			exitCode: typeof execError.code === "number" ? execError.code : 1,
			stdout: execError.stdout || "",
			stderr: execError.stderr || "",
		};
	}
};

export interface SafeSpawnParams {
	command: string;
	args: string[];
	env?: NodeJS.ProcessEnv;
	signal?: AbortSignal;
	onStdout?: (line: string) => void;
	onStderr?: (error: string) => void;
}

type SpawnResult = {
	exitCode: number;
	summary: string;
	error: string;
};

export const safeSpawn = (params: SafeSpawnParams) => {
	const { command, args, env = {}, signal, onStdout, onStderr } = params;

	let lastStdout = "";
	let lastStderr = "";

	return new Promise<SpawnResult>((resolve) => {
		const child = spawn(command, args, {
			env: { ...process.env, ...env },
			signal: signal,
		});

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");

		const rl = createInterface({ input: child.stdout });
		const rlErr = createInterface({ input: child.stderr });

		rl.on("line", (line) => {
			if (onStdout) onStdout(line);
			const trimmed = line.trim();
			if (trimmed.length > 0) {
				lastStdout = line;
			}
		});

		rlErr.on("line", (line) => {
			if (onStderr) onStderr(line);
			const trimmed = line.trim();
			if (trimmed.length > 0) {
				lastStderr = line;
			}
		});

		child.on("error", (err) => {
			resolve({ exitCode: -1, summary: lastStdout, error: err.message || lastStderr });
		});

		child.on("close", (code) => {
			resolve({ exitCode: code ?? -1, summary: lastStdout, error: lastStderr });
		});
	});
};
