import { eq } from "drizzle-orm";
import type { DateFormatPreference, TimeFormatPreference } from "~/lib/datetime";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { usersTable } from "~/server/db/schema";
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

	if (!user) {
		const password = await cryptoUtils.deriveSecret("zerobyte:desktop-user-password");
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

	const desktopUser = await db.query.usersTable.findFirst({ where: { id: user.id } });
	if (!desktopUser) {
		throw new Error("Failed to load desktop user");
	}

	return desktopUser;
};
