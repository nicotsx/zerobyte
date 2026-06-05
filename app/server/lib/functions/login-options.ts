import { createServerFn } from "@tanstack/react-start";
import { hasActivePasskeyUser, isPasswordAuthSupported } from "~/server/modules/auth/helpers";
import { systemService } from "~/server/modules/system/system.service";

export const getLoginOptions = createServerFn({ method: "GET" }).handler(async () => ({
	hasPasskeySignIn: await hasActivePasskeyUser(),
	passwordLoginEnabled: isPasswordAuthSupported() && (await systemService.isPasswordLoginEnabled()),
}));
