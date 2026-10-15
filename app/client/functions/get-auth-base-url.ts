import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { resolveAuthBaseURL } from "~/server/lib/auth/request-base-url";

export const getAuthBaseURL = createServerFn().handler(() => resolveAuthBaseURL(getRequest()));
