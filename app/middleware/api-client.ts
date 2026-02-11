import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import {
	createRequestClient,
	runWithRequestClient,
} from "~/lib/request-client";

export const apiClientMiddleware = createMiddleware().server(async ({ next, request }) => {
	const client = createRequestClient({
		baseUrl: new URL(request.url).origin,
		headers: {
			cookie: getRequestHeaders().get("cookie") ?? "",
		},
	});

	return runWithRequestClient(client, () => next());
});
