import { createFileRoute } from "@tanstack/react-router";
import { createApp } from "~/server/app";
import { config } from "~/server/core/config";

const app = createApp();

type NodeRuntimeRequest = Request & {
	ip?: string;
	runtime?: {
		node?: {
			res?: { setTimeout: (timeoutMs: number) => void };
		};
	};
};

type RequestInitWithDuplex = RequestInit & {
	duplex?: "half";
};

const prepareApiRequest = (request: NodeRuntimeRequest, timeoutMs: number) => {
	request.runtime?.node?.res?.setTimeout(timeoutMs);

	if (config.trustProxy && request.headers.has("x-forwarded-for")) {
		return request.clone();
	}

	const remoteAddress = request.ip;
	const headers = new Headers(request.headers);

	if (remoteAddress) {
		headers.set("x-forwarded-for", remoteAddress);
	} else {
		headers.delete("x-forwarded-for");
	}

	const init: RequestInitWithDuplex = {
		method: request.method,
		headers,
		body: request.body,
		signal: request.signal,
		duplex: request.body ? "half" : undefined,
	};

	return new Request(request.url, init);
};

const handle = ({ request }: { request: Request }) =>
	app.fetch(prepareApiRequest(request, config.serverIdleTimeout * 1000));

export const Route = createFileRoute("/api/$")({
	server: {
		handlers: {
			ANY: handle,
		},
	},
});
