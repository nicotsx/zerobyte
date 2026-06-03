import { createServer, type IncomingHttpHeaders } from "node:http";
import { expect } from "@playwright/test";

export type WebhookReceiverRequest = {
	method: string;
	path: string;
	headers: IncomingHttpHeaders;
	body: string;
	json: unknown;
};

export async function startWebhookReceiver(port: number) {
	const requests: WebhookReceiverRequest[] = [];

	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = Buffer.concat(chunks).toString("utf8");

		requests.push({
			method: request.method ?? "",
			path: new URL(request.url ?? "/", "http://receiver.test").pathname,
			headers: request.headers,
			body,
			json: JSON.parse(body),
		});

		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify({ ok: true }));
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "0.0.0.0", () => {
			server.off("error", reject);
			resolve();
		});
	});

	return {
		waitFor: async (predicate: (request: WebhookReceiverRequest) => boolean) => {
			await expect
				.poll(() => requests.some(predicate), {
					timeout: 30000,
					message: `Received webhook requests: ${JSON.stringify(requests, null, 2)}`,
				})
				.toBe(true);

			return requests.find(predicate)!;
		},
		close: async () => {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		},
	};
}
