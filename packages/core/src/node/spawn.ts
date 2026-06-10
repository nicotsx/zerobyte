import { spawn, execFile, type ExecException, type ExecFileOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { setPriority } from "node:os";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

type ExecProps = {
	command: string;
	args?: string[];
	env?: NodeJS.ProcessEnv;
} & ExecFileOptions;

export const safeExec = async ({ command, args = [], env = {}, ...rest }: ExecProps) => {
	const options = {
		env: { ...process.env, ...env },
	};

	try {
		const { stdout, stderr } = await promisify(execFile)(command, args, {
			...options,
			...rest,
			shell: false,
			encoding: "utf8",
		});

		return { exitCode: 0, stdout, stderr, timedOut: false };
	} catch (error) {
		const execError = error as ExecException & { killed?: boolean };
		const timedOut = execError.killed === true && execError.code === null;

		return {
			exitCode: typeof execError.code === "number" ? execError.code : 1,
			stdout: execError.stdout || "",
			stderr: timedOut ? "Command timed out before completing" : execError.stderr || execError.message || "",
			timedOut,
		};
	}
};

interface SafeSpawnParamsBase {
	command: string;
	args: string[];
	env?: NodeJS.ProcessEnv;
	signal?: AbortSignal;
	priority?: "background";
	onStderr?: (error: string) => void;
	onSpawn?: (child: ReturnType<typeof spawn>) => void;
}

export interface SafeSpawnParamsLines extends SafeSpawnParamsBase {
	stdoutMode?: "lines";
	onStdout?: (line: string) => void;
}

export interface SafeSpawnParamsRaw extends SafeSpawnParamsBase {
	stdoutMode: "raw";
	onStdout?: never;
}

export type SafeSpawnParams = SafeSpawnParamsLines | SafeSpawnParamsRaw;

export type SpawnResult = {
	exitCode: number;
	summary: string;
	error: string;
	stderr?: string;
};

const MAX_STDERR_LINES = 50;
const BACKGROUND_NICE_VALUE = 10;

const getBackgroundCommand = (command: string, args: string[]) => {
	const ionice = ["/bin/ionice", "/usr/bin/ionice"].find((path) => existsSync(path));

	if (ionice) {
		return {
			command: ionice,
			args: ["-c", "3", command, ...args],
		};
	}

	return { command, args };
};

const setBackgroundPriority = (pid: number | undefined) => {
	if (!pid) return;

	try {
		setPriority(pid, BACKGROUND_NICE_VALUE);
	} catch {
		// some oses can reject priority changes
	}
};

export function safeSpawn(params: SafeSpawnParamsLines): Promise<SpawnResult>;
export function safeSpawn(params: SafeSpawnParamsRaw): Promise<SpawnResult>;
export function safeSpawn(params: SafeSpawnParams): Promise<SpawnResult> {
	const { command, args, env = {}, signal, priority, onStderr, onSpawn } = params;
	const spawnCommand = priority === "background" ? getBackgroundCommand(command, args) : { command, args };
	const stdoutMode = params.stdoutMode ?? "lines";
	const onStdout = stdoutMode === "lines" ? params.onStdout : undefined;

	let lastStdout = "";
	let lastStderr = "";
	const stderrLines: string[] = [];

	return new Promise<SpawnResult>((resolve) => {
		const child = spawn(spawnCommand.command, spawnCommand.args, {
			env: { ...process.env, ...env },
			shell: false,
			signal: signal,
			stdio: ["ignore", "pipe", "pipe"],
		});

		if (priority === "background") {
			setBackgroundPriority(child.pid);
		}

		onSpawn?.(child);

		child.stderr.setEncoding("utf8");

		const rlErr = createInterface({ input: child.stderr });
		let rl: ReturnType<typeof createInterface> | undefined;

		if (stdoutMode === "lines") {
			child.stdout.setEncoding("utf8");

			rl = createInterface({ input: child.stdout });

			rl.on("line", (line) => {
				if (onStdout) onStdout(line);
				const trimmed = line.trim();
				if (trimmed.length > 0) {
					lastStdout = line;
				}
			});
		}

		rlErr.on("line", (line) => {
			if (onStderr) onStderr(line);
			stderrLines.push(line);
			if (stderrLines.length > MAX_STDERR_LINES) {
				stderrLines.shift();
			}
			const trimmed = line.trim();
			if (trimmed.length > 0) {
				lastStderr = line;
			}
		});

		child.on("error", (err) => {
			rlErr.close();
			rl?.close();

			resolve({
				exitCode: -1,
				summary: lastStdout,
				error: err.message || lastStderr,
				stderr: stderrLines.join("\n"),
			});
		});

		child.on("close", (code) => {
			resolve({
				exitCode: code ?? -1,
				summary: lastStdout,
				error: lastStderr,
				stderr: stderrLines.join("\n"),
			});
		});
	});
}
