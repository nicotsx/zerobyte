import { spawn, type ChildProcess } from "node:child_process";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { toMessage } from "@zerobyte/core/utils";

type ResticBridgePayload = {
	args: string[];
	env: Record<string, string>;
};

type ResticBridgeFrame =
	| { type: "stdout" | "stderr"; data: string }
	| { type: "exit"; code: number }
	| { type: "error"; message: string };

const writeFrame = async (res: ServerResponse, frame: ResticBridgeFrame) => {
	if (res.destroyed || res.writableEnded) {
		return;
	}

	await new Promise<void>((resolve) => {
		res.write(`${JSON.stringify(frame)}\n`, () => resolve());
	});
};

const readPayload = async (req: IncomingMessage): Promise<ResticBridgePayload> => {
	req.setEncoding("utf-8");
	let raw = "";

	for await (const chunk of req) {
		raw += chunk;
	}

	return JSON.parse(raw) as ResticBridgePayload;
};

export const startResticBridge = async ({
	realResticCommand,
	launchSecret,
}: {
	realResticCommand: string;
	launchSecret: string;
}) => {
	const activeChildren = new Set<ChildProcess>();
	const runRestic = (payload: ResticBridgePayload, req: IncomingMessage, res: ServerResponse) => {
		const forward = async (stream: AsyncIterable<Buffer>, type: "stdout" | "stderr") => {
			try {
				for await (const data of stream) {
					await writeFrame(res, { type, data: data.toString("base64") });
				}
			} catch (error) {
				await writeFrame(res, { type: "error", message: toMessage(error) });
			}
		};
		const child = spawn(realResticCommand, payload.args, {
			env: payload.env,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const killChild = () => child.kill("SIGTERM");
		const cleanup = () => {
			req.off("aborted", killChild);
			res.off("close", killChild);
			activeChildren.delete(child);
		};

		activeChildren.add(child);
		req.on("aborted", killChild);
		res.on("close", killChild);
		const outputDone = Promise.all([
			child.stdout ? forward(child.stdout, "stdout") : undefined,
			child.stderr ? forward(child.stderr, "stderr") : undefined,
		]);
		child.on("error", (error) => {
			void writeFrame(res, { type: "error", message: error.message });
		});
		child.on("close", async (code) => {
			cleanup();
			await outputDone;
			await writeFrame(res, { type: "exit", code: code ?? -1 });
			res.end();
		});
	};

	const server = http.createServer(async (req, res) => {
		if (req.method !== "POST" || req.url !== "/restic") {
			res.writeHead(404).end();
			return;
		}

		if (req.headers["x-zerobyte-desktop-launch-secret"] !== launchSecret) {
			res.writeHead(401).end("Invalid desktop launch secret");
			return;
		}

		res.writeHead(200, { "Content-Type": "application/x-ndjson" });

		try {
			runRestic(await readPayload(req), req, res);
		} catch (error) {
			await writeFrame(res, {
				type: "error",
				message: error instanceof Error ? error.message : String(error),
			});
			await writeFrame(res, { type: "exit", code: -1 });
			res.end();
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		server.close();
		throw new Error("Failed to start Restic bridge");
	}

	return {
		url: `http://127.0.0.1:${address.port}`,
		stop: () => {
			server.close();
			for (const child of activeChildren) {
				if (!child.killed) {
					child.kill("SIGTERM");
				}
			}
		},
	};
};
