import { eq, lt } from "drizzle-orm";
import { db } from "../../db/db";
import { sessionsTable, usersTable } from "../../db/schema";
import { logger } from "../../utils/logger";

const SESSION_DURATION = 60 * 60 * 24 * 30; // 30 days in seconds

export class AuthService {
	/**
	 * Register a new user with username and password
	 */
	async register(username: string, password: string) {
		const [existingUser] = await db.select().from(usersTable);

		if (existingUser) {
			throw new Error("Admin user already exists");
		}

		const passwordHash = await Bun.password.hash(password, {
			algorithm: "argon2id",
			memoryCost: 19456,
			timeCost: 2,
		});

		const [user] = await db.insert(usersTable).values({ username, passwordHash }).returning();

		if (!user) {
			throw new Error("User registration failed");
		}

		logger.info(`User registered: ${username}`);
		const sessionId = crypto.randomUUID();
		const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION;

		await db.insert(sessionsTable).values({
			id: sessionId,
			userId: user.id,
			expiresAt,
		});

		return {
			user: {
				id: user.id,
				username: user.username,
				createdAt: user.createdAt,
				hasDownloadedResticPassword: user.hasDownloadedResticPassword,
			},
			sessionId,
		};
	}

	/**
	 * Login user with username and password
	 */
	async login(username: string, password: string) {
		const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));

		if (!user) {
			throw new Error("Invalid credentials");
		}

		const isValid = await Bun.password.verify(password, user.passwordHash);

		if (!isValid) {
			throw new Error("Invalid credentials");
		}

		const sessionId = crypto.randomUUID();
		const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION;

		await db.insert(sessionsTable).values({
			id: sessionId,
			userId: user.id,
			expiresAt,
		});

		logger.info(`User logged in: ${username}`);

		return {
			sessionId,
			user: {
				id: user.id,
				username: user.username,
				hasDownloadedResticPassword: user.hasDownloadedResticPassword,
			},
			expiresAt,
		};
	}

	/**
	 * Logout user by deleting their session
	 */
	async logout(sessionId: string) {
		await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));
		logger.info(`User logged out: session ${sessionId}`);
	}

	/**
	 * Verify a session and return the associated user
	 */
	async verifySession(sessionId: string) {
		const [session] = await db
			.select({
				session: sessionsTable,
				user: usersTable,
			})
			.from(sessionsTable)
			.innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
			.where(eq(sessionsTable.id, sessionId));

		if (!session) {
			return null;
		}

		if (session.session.expiresAt < Math.floor(Date.now() / 1000)) {
			await db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId));
			return null;
		}

		return {
			user: {
				id: session.user.id,
				username: session.user.username,
				hasDownloadedResticPassword: session.user.hasDownloadedResticPassword,
			},
			session: {
				id: session.session.id,
				expiresAt: session.session.expiresAt,
			},
		};
	}

	/**
	 * Clean up expired sessions
	 */
	async cleanupExpiredSessions() {
		const result = await db
			.delete(sessionsTable)
			.where(lt(sessionsTable.expiresAt, Math.floor(Date.now() / 1000)))
			.returning();
		if (result.length > 0) {
			logger.info(`Cleaned up ${result.length} expired sessions`);
		}
	}

	/**
	 * Check if any users exist in the system
	 */
	async hasUsers(): Promise<boolean> {
		const [user] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
		return !!user;
	}

	/**
	 * Change password for a user
	 */
	async changePassword(userId: number, currentPassword: string, newPassword: string) {
		const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

		if (!user) {
			throw new Error("User not found");
		}

		const isValid = await Bun.password.verify(currentPassword, user.passwordHash);

		if (!isValid) {
			throw new Error("Current password is incorrect");
		}

		const newPasswordHash = await Bun.password.hash(newPassword, {
			algorithm: "argon2id",
			memoryCost: 19456,
			timeCost: 2,
		});

		await db.update(usersTable).set({ passwordHash: newPasswordHash }).where(eq(usersTable.id, userId));

		logger.info(`Password changed for user: ${user.username}`);
	}
}

export const authService = new AuthService();
