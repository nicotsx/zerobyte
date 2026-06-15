import { eq } from "drizzle-orm";
import type { DateFormatPreference, TimeFormatPreference } from "~/lib/datetime";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { usersTable } from "~/server/db/schema";
import { ensureDefaultOrg } from "~/server/lib/auth/helpers/create-default-org";
import { auth } from "~/server/lib/auth";
import { cryptoUtils } from "~/server/utils/crypto";

export const DESKTOP_USER_EMAIL = "desktop@zerobyte.local";
export const DESKTOP_USERNAME = "desktop-admin";

export const getDesktopUserPassword = () => cryptoUtils.deriveSecret("zerobyte:desktop-user-password");

type DesktopDateTimePreferences = {
	dateFormat: DateFormatPreference;
	timeFormat: TimeFormatPreference;
};

export const ensureDesktopIdentity = async ({ dateFormat, timeFormat }: DesktopDateTimePreferences) => {
	if (config.runtime !== "desktop") {
		return;
	}

	const password = await getDesktopUserPassword();
	let user = await db.query.usersTable.findFirst({ where: { email: DESKTOP_USER_EMAIL } });

	if (!user) {
		await auth.api.signUpEmail({
			body: {
				email: DESKTOP_USER_EMAIL,
				password,
				name: "Zerobyte",
				username: DESKTOP_USERNAME,
				rememberMe: false,
				hasDownloadedResticPassword: false,
				dateFormat,
				timeFormat,
			},
		});

		user = await db.query.usersTable.findFirst({ where: { email: DESKTOP_USER_EMAIL } });
	}

	if (!user) {
		throw new Error("Failed to bootstrap desktop user");
	}

	await ensureDefaultOrg(user.id);

	await db
		.update(usersTable)
		.set({ role: "admin", emailVerified: true, updatedAt: new Date() })
		.where(eq(usersTable.id, user.id));
};
