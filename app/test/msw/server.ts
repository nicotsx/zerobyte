import type { HttpRequestEventMap, Interceptor } from "@mswjs/interceptors";
import { FetchInterceptor } from "@mswjs/interceptors/fetch/web";
import { defineNetwork, InterceptorSource } from "msw/experimental";

export { HttpResponse, http } from "msw/http";

// Bun needs direct fetch interception; the web build duplicates the Node build's private base-class declaration.
const fetchInterceptor = new FetchInterceptor() as unknown as Interceptor<HttpRequestEventMap>;

export const server = defineNetwork({
	sources: [new InterceptorSource({ interceptors: [fetchInterceptor] })],
	onUnhandledFrame: "error",
	context: { quiet: true },
});
