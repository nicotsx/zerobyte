import { createMiddleware } from "@tanstack/react-start";
import { client } from "~/client/api-client/client.gen";
import { getRequestHeaders } from "@tanstack/react-start/server";

export const apiClientMiddleware = createMiddleware().server(async ({ next, request }) => {
	client.setConfig({
		baseUrl: `${new URL(request.url).origin}`,
		headers: {
			cookie: getRequestHeaders().get("cookie") ?? "",
		},
	});

	return next();
});
