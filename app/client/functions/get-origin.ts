import { createServerFn } from "@tanstack/react-start";
import { config } from "~/server/core/config";

export const getOrigin = createServerFn().handler(() => {
	return config.baseUrl;
});
