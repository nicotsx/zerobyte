#!/usr/bin/env bun

import type { Writable } from "node:stream";

type ResticBridgeFrame =
	| { type: "stdout" | "stderr"; data: string }
	| { type: "exit"; code: number }
	| { type: "error"; message: string };

const bridgeUrl = process.env.ZEROBYTE_DESKTOP_RESTIC_BRIDGE_URL;
const launchSecret = process.env.ZEROBYTE_DESKTOP_LAUNCH_SECRET;

const writeOutput = async (stream: Writable, data: Buffer) => {
	if (stream.destroyed || stream.writableEnded) {
		return;
	}

	await new Promise<void>((resolve) => {
		stream.write(data, () => resolve());
	});
};

const readExitCode = async (body: ReadableStream<Uint8Array>) => {
	const decoder = new TextDecoder();
	let buffer = "";
	let exitCode: number | null = null;
	const readLine = async (line: string) => {
		if (!line.trim()) {
			return;
		}

		const frame = JSON.parse(line) as ResticBridgeFrame;
		switch (frame.type) {
			case "stdout":
				await writeOutput(process.stdout, Buffer.from(frame.data, "base64"));
				return;
			case "stderr":
				await writeOutput(process.stderr, Buffer.from(frame.data, "base64"));
				return;
			case "error":
				process.stderr.write(`${frame.message}\n`);
				return;
			case "exit":
				return frame.code;
		}
	};

	for await (const value of body) {
		buffer += decoder.decode(value, { stream: true });
		let newlineIndex = buffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = buffer.slice(0, newlineIndex);
			buffer = buffer.slice(newlineIndex + 1);
			exitCode = (await readLine(line)) ?? exitCode;
			newlineIndex = buffer.indexOf("\n");
		}
	}

	buffer += decoder.decode();
	if (buffer.length > 0) {
		exitCode = (await readLine(buffer)) ?? exitCode;
	}

	return exitCode;
};

let exitCode = 1;
try {
	if (!bridgeUrl || !launchSecret) {
		process.stderr.write("Zerobyte Restic bridge is not configured\n");
		exitCode = 127;
	} else {
		const env = { ...process.env };
		delete env.ZEROBYTE_DESKTOP_RESTIC_BRIDGE_URL;
		delete env.ZEROBYTE_DESKTOP_LAUNCH_SECRET;

		const response = await fetch(`${bridgeUrl}/restic`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Zerobyte-Desktop-Launch-Secret": launchSecret,
			},
			body: JSON.stringify({
				args: process.argv.slice(2),
				env,
			}),
		});

		if (!response.ok) {
			process.stderr.write(`${await response.text()}\n`);
		} else if (!response.body) {
			process.stderr.write("Zerobyte Restic bridge returned an empty response\n");
		} else {
			exitCode = (await readExitCode(response.body)) ?? 1;
		}
	}
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
}

process.exitCode = exitCode;

export {};
