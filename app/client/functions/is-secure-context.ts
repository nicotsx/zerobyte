import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import ipaddr from "ipaddr.js";

const getFirstHeaderValue = (value: string | null) => value?.split(",")[0]?.trim();

const isLoopbackIp = (hostname: string) => {
	try {
		return ipaddr.parse(hostname).range() === "loopback";
	} catch {
		return false;
	}
};

const getRequestOrigin = (request: Request) => {
	const requestUrl = new URL(request.url);
	const forwardedProto = getFirstHeaderValue(request.headers.get("x-forwarded-proto"));
	const forwardedHost = getFirstHeaderValue(request.headers.get("x-forwarded-host"));
	const host = forwardedHost || getFirstHeaderValue(request.headers.get("host"));

	if (!host) {
		return requestUrl.origin;
	}

	const protocol = (forwardedProto || requestUrl.protocol).replace(/:$/, "");
	return `${protocol}://${host}`;
};

export const isSecureContextOrigin = (origin: string) => {
	const url = new URL(origin);

	if (url.protocol === "https:") {
		return true;
	}

	const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();

	return hostname === "localhost" || hostname.endsWith(".localhost") || isLoopbackIp(hostname);
};

export const getIsSecureContextForRequest = (request: Request) => isSecureContextOrigin(getRequestOrigin(request));

export const getIsSecureContext = createIsomorphicFn()
	.server(() => {
		try {
			return getIsSecureContextForRequest(getRequest());
		} catch {
			return true;
		}
	})
	.client(() => window.isSecureContext ?? true);
