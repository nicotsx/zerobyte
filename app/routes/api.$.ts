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

export const prepareApiRequest = (request: Request, timeoutMs: number) => {
	const nodeRequest = request as NodeRuntimeRequest;
	nodeRequest.runtime?.node?.res?.setTimeout(timeoutMs);

	if (config.trustProxy && request.headers.has("x-forwarded-for")) {
		return request.clone();
	}

	const remoteAddress = nodeRequest.ip;
	if (remoteAddress) {
		const headers = new Headers(request.headers);
		headers.set("x-forwarded-for", remoteAddress);

		return new Request(request, { headers });
	}

	const headers = new Headers(request.headers);
	headers.delete("x-forwarded-for");

	return new Request(request, { headers });
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
