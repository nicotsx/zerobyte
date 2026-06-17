import { eq } from "drizzle-orm";
import { UnauthorizedError } from "http-errors-enhanced";
import type { DateFormatPreference, TimeFormatPreference } from "~/lib/datetime";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { usersTable } from "~/server/db/schema";
import { verifyUserPassword } from "~/server/modules/auth/helpers";
import { ensureDefaultOrg } from "~/server/lib/auth/helpers/create-default-org";
import { auth } from "~/server/lib/auth";
import { cryptoUtils } from "~/server/utils/crypto";
import { DESKTOP_USER_EMAIL, DESKTOP_USERNAME } from "./constants";

type DesktopDateTimePreferences = {
	dateFormat: DateFormatPreference;
	timeFormat: TimeFormatPreference;
};

export const ensureDesktopIdentity = async ({ dateFormat, timeFormat }: DesktopDateTimePreferences) => {
	if (config.runtime !== "desktop") {
		return;
	}

	let user = await db.query.usersTable.findFirst({ where: { email: DESKTOP_USER_EMAIL } });
	const password = await cryptoUtils.deriveSecret("zerobyte:desktop-user-password");

	if (!user) {
		const authContext = await auth.$context;
		const passwordHash = await authContext.password.hash(password);

		await authContext.internalAdapter.createUser({
			email: DESKTOP_USER_EMAIL,
			name: "Zerobyte",
			username: DESKTOP_USERNAME,
			hasDownloadedResticPassword: false,
			dateFormat,
			timeFormat,
			emailVerified: false,
		});

		user = await db.query.usersTable.findFirst({ where: { email: DESKTOP_USER_EMAIL } });
		if (!user) {
			throw new Error("Failed to bootstrap desktop user");
		}

		await authContext.internalAdapter.linkAccount({
			userId: user.id,
			providerId: "credential",
			accountId: user.id,
			password: passwordHash,
		});
	} else if (!(await verifyUserPassword({ userId: user.id, password }))) {
		throw new UnauthorizedError("Reserved desktop user is not trusted");
	}

	if (!user) {
		throw new Error("Failed to bootstrap desktop user");
	}

	await ensureDefaultOrg(user.id);

	await db
		.update(usersTable)
		.set({ role: "admin", emailVerified: true, updatedAt: new Date() })
		.where(eq(usersTable.id, user.id));

	const desktopUser = await db.query.usersTable.findFirst({ where: { id: user.id } });
	if (!desktopUser) {
		throw new Error("Failed to load desktop user");
	}

	return desktopUser;
};
