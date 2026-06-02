import { createServerFn } from "@tanstack/react-start";
import { hasActivePasskeyUser } from "~/server/modules/auth/helpers";

export const getLoginOptions = createServerFn({ method: "GET" }).handler(async () => ({
	hasPasskeySignIn: await hasActivePasskeyUser(),
}));
