import { createIsomorphicFn } from "@tanstack/react-start";
import { config } from "~/server/core/config";

export const getOrigin = createIsomorphicFn()
	.server(() => config.baseUrl)
	.client(() => window.location.origin);
