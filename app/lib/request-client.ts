import type { Config } from "~/client/api-client/client";
import { createClient, createConfig } from "~/client/api-client/client";

type RequestClient = ReturnType<typeof createClient>;

type RequestClientStore = {
	getStore: () => RequestClient | undefined;
	run: <T>(client: RequestClient, fn: () => T) => T;
};

type AsyncLocalStorageConstructor = new <T>() => {
	getStore: () => T | undefined;
	run: <R>(store: T, callback: () => R) => R;
};

let requestClientStore: RequestClientStore | undefined;
let requestClientStorePromise: Promise<RequestClientStore | undefined> | undefined;

const ASYNC_HOOKS_MODULE = "node:async_hooks";

const loadRequestClientStore = async (): Promise<RequestClientStore | undefined> => {
	if (typeof window !== "undefined") {
		return undefined;
	}

	if (!requestClientStorePromise) {
		requestClientStorePromise = (async () => {
			const asyncHooksModule = (await import(/* @vite-ignore */ ASYNC_HOOKS_MODULE)) as {
				AsyncLocalStorage: AsyncLocalStorageConstructor;
			};
			requestClientStore = new asyncHooksModule.AsyncLocalStorage<RequestClient>();
			return requestClientStore;
		})();
	}

	return requestClientStorePromise;
};

// fallow-ignore-next-line unused-export
export function getRequestClient(): RequestClient {
	const client = requestClientStore?.getStore();

	if (!client) {
		throw new Error("No request client available");
	}

	return client;
}

export async function runWithRequestClient<T>(client: RequestClient, fn: () => T): Promise<T> {
	const store = await loadRequestClientStore();

	if (!store) {
		return fn();
	}

	return store.run(client, fn);
}

export function createRequestClient(config: Config & { baseUrl: string }, internalOrigin: string): RequestClient {
	const client = createClient(createConfig(config));
	const publicUrl = new URL(config.baseUrl);
	const internalUrl = new URL(internalOrigin);

	client.interceptors.request.use((request) => {
		const url = new URL(request.url);
		if (url.origin !== publicUrl.origin) return request;

		url.protocol = internalUrl.protocol;
		url.hostname = internalUrl.hostname;
		url.port = internalUrl.port;
		return new Request(url, request);
	});

	return client;
}
