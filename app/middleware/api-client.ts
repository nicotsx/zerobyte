import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders, getRequestUrl } from "@tanstack/react-start/server";
import { createRequestClient, runWithRequestClient } from "~/lib/request-client";
import { config } from "../server/core/config";

export const apiClientMiddleware = createMiddleware().server(async ({ next }) => {
	const baseUrl = getRequestUrl({ xForwardedHost: true }).origin;
	const internalOrigin = `http://127.0.0.1:${config.port}`;
	const cookie = getRequestHeaders().get("cookie") ?? "";
	const client = createRequestClient(
		{
			baseUrl,
			headers: { cookie },
		},
		internalOrigin,
	);

	return runWithRequestClient(client, () => next());
});
