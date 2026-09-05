import { createFileRoute } from "@tanstack/react-router";
import { createApp } from "~/server/app";
import { config } from "~/server/core/config";

const app = createApp();

const BUN_MAX_IDLE_TIMEOUT_SECONDS = 255;

type RuntimeRequest = Request & {
	ip?: string;
	runtime?: {
		node?: {
			res?: { setTimeout: (timeoutMs: number) => void };
		};
		bun?: {
			server: { timeout: (request: Request, timeoutSeconds: number) => void };
		};
	};
};

type RequestInitWithDuplex = RequestInit & {
	duplex?: "half";
};

const prepareApiRequest = (request: RuntimeRequest, timeoutSeconds: number) => {
	const timeoutMs = timeoutSeconds * 1000;
	const bunTimeoutSeconds = Math.min(timeoutSeconds, BUN_MAX_IDLE_TIMEOUT_SECONDS);

	request.runtime?.node?.res?.setTimeout(timeoutMs);
	request.runtime?.bun?.server.timeout(request, bunTimeoutSeconds);

	if (config.trustProxy && request.headers.has("x-forwarded-for")) {
		return request.clone();
	}

	const remoteAddress = request.ip;
	const headers = new Headers(request.headers);
	const body = request.body;
	const duplex = body ? "half" : undefined;

	if (remoteAddress) {
		headers.set("x-forwarded-for", remoteAddress);
	} else {
		headers.delete("x-forwarded-for");
	}

	const init: RequestInitWithDuplex = {
		method: request.method,
		headers,
		body,
		signal: request.signal,
		duplex,
	};

	return new Request(request.url, init);
};

const handle = ({ request }: { request: Request }) => app.fetch(prepareApiRequest(request, config.serverIdleTimeout));

export const Route = createFileRoute("/api/$")({
	server: {
		handlers: {
			ANY: handle,
		},
	},
});
