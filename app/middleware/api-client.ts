import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders, getRequestUrl } from "@tanstack/react-start/server";
import { createRequestClient, runWithRequestClient } from "~/lib/request-client";
import { config } from "../server/core/config";

export const apiClientMiddleware = createMiddleware().server(async ({ next }) => {
	const baseUrl = getRequestUrl({ xForwardedHost: true }).origin;
	const desktop = config.runtime === "desktop";
	const internalOrigin = `${desktop ? "https" : "http"}://127.0.0.1:${config.port}`;
	const requestHeaders = getRequestHeaders();
	const forwardedHeaders = new Headers();

	for (const name of ["cookie", "origin", "sec-fetch-site"]) {
		const value = requestHeaders.get(name);
		if (value !== null) forwardedHeaders.set(name, value);
	}

	function fetchDesktop(input: RequestInfo | URL, init?: RequestInit) {
		const request = new Request(input, init);
		if (new URL(request.url).origin !== internalOrigin) return fetch(request);

		const certificate = process.env.NITRO_SSL_CERT;
		if (!certificate) throw new Error("Desktop SSR is missing its TLS certificate");

		return fetch(request, { redirect: "error", tls: { ca: certificate } });
	}
	fetchDesktop.preconnect = fetch.preconnect;

	const client = createRequestClient(
		{
			baseUrl,
			headers: forwardedHeaders,
			fetch: desktop ? fetchDesktop : fetch,
		},
		internalOrigin,
	);

	return runWithRequestClient(client, () => next());
});
