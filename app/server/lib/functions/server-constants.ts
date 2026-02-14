import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { UnauthorizedError } from "http-errors-enhanced";
import { auth } from "~/server/lib/auth";
import { REGISTRATION_ENABLED_KEY, REPOSITORY_BASE } from "~/server/core/constants";

export const getServerConstants = createServerFn({ method: "GET" }).handler(async () => {
	const headers = getRequestHeaders();
	const session = await auth.api.getSession({ headers });

	if (!session?.user) {
		throw new UnauthorizedError("Invalid or expired session");
	}

	return {
		REPOSITORY_BASE,
		REGISTRATION_ENABLED_KEY,
	};
});
