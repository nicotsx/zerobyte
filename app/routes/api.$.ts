import { createFileRoute } from "@tanstack/react-router";
import { createApp } from "~/server/app";
import { config } from "~/server/core/config";

const app = createApp();

type NodeRuntimeRequest = Request & {
	runtime?: {
		node?: {
			res?: { setTimeout: (timeoutMs: number) => void };
		};
	};
};

export const prepareApiRequest = (request: Request, timeoutMs: number) => {
	const nodeRequest = request as NodeRuntimeRequest;
	nodeRequest.runtime?.node?.res?.setTimeout(timeoutMs);

	return request.clone();
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
