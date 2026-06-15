import { BadRequestError, UnauthorizedError } from "http-errors-enhanced";
import { config } from "~/server/core/config";
import { auth } from "~/server/lib/auth";
import { ensureDesktopIdentity } from "~/server/modules/desktop/bootstrap";
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

const createDesktopSession = async (body: CreateDesktopSessionBody) => {
	assertDesktopRuntime();

	const user = await ensureDesktopIdentity(body);
	if (!user) {
		throw new Error("Failed to bootstrap desktop user");
	}

	const ctx = await auth.$context;
	const session = await ctx.internalAdapter.createSession(user.id, false, { authSource: "desktop-session" }, true);
	if (!session) {
		throw new Error("Failed to create desktop session");
	}

	return { session, user };
};

export const desktopService = {
	createDesktopSession,
};
