import { Readable } from "node:stream";
import { expect, test } from "vitest";
import { readConnectionCodeFromStdin } from "../connection-code";

test("reads one connection code from stdin without requiring an argv value", async () => {
	await expect(readConnectionCodeFromStdin(Readable.from(["  one-time-code\nignored"]))).resolves.toBe(
		"one-time-code",
	);
});

test.each(["\n", `${"x".repeat(4097)}\n`])("rejects invalid stdin input", async (input) => {
	await expect(readConnectionCodeFromStdin(Readable.from([input]))).rejects.toThrow();
});

test.skipIf(process.platform === "win32")(
	"accepts a terminal connection code and exits cleanly without revealing it",
	async () => {
		const code = "test-connection-code";
		const modulePath = new URL("../connection-code.ts", import.meta.url).pathname;
		const source = `
			import { promptConnectionCode } from ${JSON.stringify(modulePath)};
			const code = await promptConnectionCode();
			if (code !== ${JSON.stringify(code)}) throw new Error("Unexpected connection code");
			await new Promise((resolve) => setImmediate(resolve));
			console.log("PROMPT_COMPLETE");
		`;
		let output = "";
		let submitted = false;
		const child = Bun.spawn([process.execPath, "-e", source], {
			timeout: 5_000,
			killSignal: "SIGKILL",
			terminal: {
				data(terminal, data) {
					output += Buffer.from(data).toString("utf8");

					if (!submitted && output.includes("? Connection code")) {
						submitted = true;
						terminal.write(`${code}\r`);
					}
				},
			},
		});

		try {
			expect(await child.exited, output).toBe(0);
			expect(submitted).toBe(true);
			expect(output).toContain("PROMPT_COMPLETE");
			expect(output).not.toContain(code);
		} finally {
			child.kill();
			child.terminal?.close();
		}
	},
	10_000,
);
