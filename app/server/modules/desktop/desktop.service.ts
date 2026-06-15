import { BadRequestError, UnauthorizedError } from "http-errors-enhanced";
import { config } from "~/server/core/config";
import { auth } from "~/server/lib/auth";
import { DESKTOP_USER_EMAIL, ensureDesktopIdentity, getDesktopUserPassword } from "~/server/modules/desktop/bootstrap";
import { cryptoUtils } from "~/server/utils/crypto";
import type { CreateDesktopSessionBody } from "./desktop.dto";

export const DESKTOP_LAUNCH_SECRET_HEADER = "X-Zerobyte-Desktop-Launch-Secret";

export const assertDesktopRuntime = () => {
	if (config.runtime !== "desktop") {
		throw new BadRequestError("Desktop runtime is not enabled");
	}
};

export const verifyDesktopLaunchSecret = (secret: string | undefined) => {
	assertDesktopRuntime();

	const expected = config.desktop.launchSecret;
	if (!secret || !expected) {
		throw new UnauthorizedError("Invalid desktop launch secret");
	}

	if (!cryptoUtils.timingSafeEqualString(secret, expected)) {
		throw new UnauthorizedError("Invalid desktop launch secret");
	}
};

const createDesktopSessionResponse = async (body: CreateDesktopSessionBody) => {
	assertDesktopRuntime();
	await ensureDesktopIdentity(body);

	const password = await getDesktopUserPassword();
	return auth.api.signInEmail({
		body: {
			email: DESKTOP_USER_EMAIL,
			password,
			rememberMe: true,
		},
		asResponse: true,
	});
};

export const desktopService = {
	createDesktopSessionResponse,
};
