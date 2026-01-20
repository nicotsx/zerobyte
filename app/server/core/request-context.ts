import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
	organizationId: string;
	userId?: string;
};

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const withContext = <T>(context: RequestContext, fn: () => T): T => {
	return requestContextStorage.run(context, fn);
};

export const getRequestContext = (): RequestContext => {
	const context = requestContextStorage.getStore();

	if (!context?.organizationId) {
		throw new Error("Organization context is missing");
	}

	return context;
};

export const getOrganizationId = () => getRequestContext().organizationId;
