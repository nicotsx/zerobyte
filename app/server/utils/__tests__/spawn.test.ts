import { describe, expect, test } from "bun:test";
import { safeExec, safeSpawn } from "../spawn";

describe("safeExec", () => {
	describe("successful commands", () => {
		test("returns exitCode 0 and output for successful command", async () => {
			const result = await safeExec({ command: "echo", args: ["hello"] });

			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toBe("hello");
			expect(result.stderr).toBe("");
			expect(result.timedOut).toBe(false);
		});
	});

	describe("failed commands", () => {
		test("returns non-zero exitCode for failed command", async () => {
			const result = await safeExec({
				command: "sh",
				args: ["-c", "exit 1"],
			});

			expect(result.exitCode).toBe(1);
			expect(result.timedOut).toBe(false);
		});

		test("captures stderr from failed command", async () => {
			const result = await safeExec({
				command: "sh",
				args: ["-c", "echo 'error message' >&2 && exit 1"],
			});

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("error message");
			expect(result.timedOut).toBe(false);
		});
	});

	describe("timeout handling", () => {
		test("detects timeout and sets timedOut flag", async () => {
			const result = await safeExec({
				command: "sleep",
				args: ["10"],
				timeout: 100,
			});

			expect(result.timedOut).toBe(true);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe("Command timed out before completing");
		});

		test("returns timedOut false when command completes within timeout", async () => {
			const result = await safeExec({
				command: "echo",
				args: ["quick"],
				timeout: 5000,
			});

			expect(result.timedOut).toBe(false);
			expect(result.exitCode).toBe(0);
		});
	});

	describe("env", () => {
		test("passes custom env variables to the command", async () => {
			const result = await safeExec({
				command: "sh",
				args: ["-c", "echo $TEST_EXEC_VAR"],
				env: { TEST_EXEC_VAR: "exec_value" },
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toBe("exec_value");
		});
	});

	describe("shell injection protection", () => {
		test("treats semicolon-separated commands as a single literal argument", async () => {
			const result = await safeExec({
				command: "echo",
				args: ["safe; echo injected"],
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toBe("safe; echo injected");
		});

		test("does not evaluate command substitution syntax", async () => {
			const result = await safeExec({
				command: "echo",
				args: ["$(echo injected)"],
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toBe("$(echo injected)");
		});

		test("does not expand glob patterns", async () => {
			const result = await safeExec({
				command: "echo",
				args: ["*.ts"],
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toBe("*.ts");
		});
	});

	describe("stdout on failure", () => {
		test("captures stdout written before a non-zero exit", async () => {
			const result = await safeExec({
				command: "sh",
				args: ["-c", "echo output_before_failure && exit 1"],
			});

			expect(result.exitCode).toBe(1);
			expect(result.stdout).toContain("output_before_failure");
		});
	});
});

describe("safeSpawn", () => {
	describe("successful commands", () => {
		test("returns exitCode 0 and correct summary", async () => {
			const result = await safeSpawn({ command: "echo", args: ["hello"] });

			expect(result.exitCode).toBe(0);
			expect(result.summary).toBe("hello");
			expect(result.error).toBe("");
		});

		test("summary is the last non-empty stdout line", async () => {
			const result = await safeSpawn({
				command: "sh",
				args: ["-c", "echo first && echo second && echo third"],
			});

			expect(result.exitCode).toBe(0);
			expect(result.summary).toBe("third");
		});

		test("skips blank and whitespace-only lines when tracking summary", async () => {
			const result = await safeSpawn({
				command: "sh",
				args: ["-c", "printf 'first\\n\\n   \\n'"],
			});

			expect(result.exitCode).toBe(0);
			expect(result.summary).toBe("first");
		});
	});

	describe("callbacks", () => {
		test("calls onStdout once per stdout line", async () => {
			const lines: string[] = [];

			await safeSpawn({
				command: "sh",
				args: ["-c", "echo line1 && echo line2 && echo line3"],
				onStdout: (line) => lines.push(line),
			});

			expect(lines).toEqual(["line1", "line2", "line3"]);
		});

		test("calls onStderr once per stderr line", async () => {
			const errors: string[] = [];

			await safeSpawn({
				command: "sh",
				args: ["-c", "echo err1 >&2 && echo err2 >&2"],
				onStderr: (line) => errors.push(line),
			});

			expect(errors).toEqual(["err1", "err2"]);
		});

		test("calls onSpawn immediately with the child process", async () => {
			let receivedChild: ReturnType<typeof import("node:child_process").spawn> | null = null;

			await safeSpawn({
				command: "echo",
				args: ["test"],
				onSpawn: (child) => {
					receivedChild = child;
				},
			});

			expect(receivedChild).not.toBeNull();
		});
	});

	describe("failed commands", () => {
		test("returns the exact non-zero exit code", async () => {
			const result = await safeSpawn({
				command: "sh",
				args: ["-c", "exit 42"],
			});

			expect(result.exitCode).toBe(42);
		});

		test("error contains the last stderr line", async () => {
			const result = await safeSpawn({
				command: "sh",
				args: ["-c", "echo err_first >&2 && echo err_last >&2 && exit 1"],
			});

			expect(result.exitCode).toBe(1);
			expect(result.error).toBe("err_last");
		});

		test("returns exitCode -1 when the command is not found", async () => {
			const result = await safeSpawn({
				command: "this-command-does-not-exist-zerobyte",
				args: [],
			});

			expect(result.exitCode).toBe(-1);
			expect(result.error.length).toBeGreaterThan(0);
		});
	});

	describe("stdoutMode", () => {
		test("raw mode skips readline and leaves summary empty", async () => {
			const result = await safeSpawn({
				command: "echo",
				args: ["hello"],
				stdoutMode: "raw",
				onSpawn: (child) => {
					child.stdout?.resume();
				},
			});

			expect(result.summary).toBe("");
		});

		test("raw mode exposes the raw stdout stream via onSpawn", async () => {
			const chunks: Buffer[] = [];

			await safeSpawn({
				command: "echo",
				args: ["raw_output"],
				stdoutMode: "raw",
				onSpawn: (child) => {
					child.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk));
				},
			});

			const output = Buffer.concat(chunks).toString("utf8").trim();
			expect(output).toBe("raw_output");
		});
	});

	describe("env", () => {
		test("passes custom env variables to the spawned process", async () => {
			const lines: string[] = [];

			await safeSpawn({
				command: "sh",
				args: ["-c", "echo $TEST_SPAWN_VAR"],
				env: { TEST_SPAWN_VAR: "spawn_value" },
				onStdout: (line) => lines.push(line),
			});

			expect(lines).toContain("spawn_value");
		});
	});

	describe("shell injection protection", () => {
		test("treats semicolon-separated commands as a single literal argument", async () => {
			const lines: string[] = [];

			await safeSpawn({
				command: "echo",
				args: ["safe; echo injected"],
				onStdout: (line) => lines.push(line),
			});

			expect(lines).toEqual(["safe; echo injected"]);
		});

		test("does not evaluate command substitution syntax", async () => {
			const lines: string[] = [];

			await safeSpawn({
				command: "echo",
				args: ["$(echo injected)"],
				onStdout: (line) => lines.push(line),
			});

			expect(lines).toEqual(["$(echo injected)"]);
		});

		test("does not expand glob patterns", async () => {
			const lines: string[] = [];

			await safeSpawn({
				command: "echo",
				args: ["*.ts"],
				onStdout: (line) => lines.push(line),
			});

			expect(lines).toEqual(["*.ts"]);
		});
	});
});
