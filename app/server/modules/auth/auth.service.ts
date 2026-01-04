import { eq, lt } from "drizzle-orm";
import { db } from "../../db/db";
import { sessionsTable, usersTable } from "../../db/schema";
import { cryptoUtils } from "../../utils/crypto";
import { logger } from "../../utils/logger";
import * as OTPAuth from "otpauth";

const SESSION_DURATION = 60 * 60 * 24 * 30 * 1000; // 30 days in milliseconds
const PENDING_2FA_DURATION = 5 * 60 * 1000; // 5 minutes for 2FA verification

// In-memory store for pending 2FA sessions (short-lived, no need for DB persistence)
interface Pending2faSession {
	userId: number;
	expiresAt: number;
}
const pending2faSessions = new Map<string, Pending2faSession>();

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
		const expiresAt = Date.now() + SESSION_DURATION;

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
	 * Returns requiresTwoFactor: true if 2FA is enabled, with a pendingSessionId
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

		// Check if 2FA is enabled
		if (user.totpEnabled && user.totpSecret) {
			// Create a pending 2FA session in memory
			const pendingSessionId = crypto.randomUUID();
			const expiresAt = Date.now() + PENDING_2FA_DURATION;

			pending2faSessions.set(pendingSessionId, {
				userId: user.id,
				expiresAt,
			});

			logger.info(`2FA required for user: ${username}`);

			return {
				requiresTwoFactor: true as const,
				pendingSessionId,
			};
		}

		// No 2FA - create full session
		const sessionId = crypto.randomUUID();
		const expiresAt = Date.now() + SESSION_DURATION;

		await db.insert(sessionsTable).values({
			id: sessionId,
			userId: user.id,
			expiresAt,
		});

		logger.info(`User logged in: ${username}`);

		return {
			requiresTwoFactor: false as const,
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
	 * Verify 2FA code and complete login
	 */
	async verifyTwoFactor(pendingSessionId: string, code: string) {
		// Find the pending session from memory
		const pendingSession = pending2faSessions.get(pendingSessionId);

		if (!pendingSession) {
			throw new Error("Invalid or expired 2FA session");
		}

		// Check if session expired
		if (pendingSession.expiresAt < Date.now()) {
			pending2faSessions.delete(pendingSessionId);
			throw new Error("2FA session expired. Please login again.");
		}

		// Get user from database
		const [user] = await db.select().from(usersTable).where(eq(usersTable.id, pendingSession.userId));

		if (!user) {
			pending2faSessions.delete(pendingSessionId);
			throw new Error("User not found");
		}

		if (!user.totpSecret) {
			throw new Error("2FA not configured for this user");
		}

		// Decrypt the TOTP secret
		const decryptedSecret = await cryptoUtils.resolveSecret(user.totpSecret);

		// Verify TOTP code
		const totp = new OTPAuth.TOTP({
			issuer: "Zerobyte",
			label: user.username,
			algorithm: "SHA1",
			digits: 6,
			period: 30,
			secret: OTPAuth.Secret.fromBase32(decryptedSecret),
		});

		const delta = totp.validate({ token: code, window: 1 });
		if (delta === null) {
			throw new Error("Invalid 2FA code");
		}

		// Delete the pending session from memory
		pending2faSessions.delete(pendingSessionId);

		// Create full session
		const sessionId = crypto.randomUUID();
		const expiresAt = Date.now() + SESSION_DURATION;

		await db.insert(sessionsTable).values({
			id: sessionId,
			userId: user.id,
			expiresAt,
		});

		logger.info(`User logged in with 2FA: ${user.username}`);

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
	 * Clean up expired pending 2FA sessions from memory
	 */
	cleanupExpiredPending2faSessions() {
		const now = Date.now();
		let count = 0;
		for (const [id, session] of pending2faSessions) {
			if (session.expiresAt < now) {
				pending2faSessions.delete(id);
				count++;
			}
		}
		if (count > 0) {
			logger.info(`Cleaned up ${count} expired pending 2FA sessions`);
		}
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

		if (session.session.expiresAt < Date.now()) {
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
		const result = await db.delete(sessionsTable).where(lt(sessionsTable.expiresAt, Date.now())).returning();
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

	/**
	 * Get 2FA status for a user
	 */
	async getTwoFactorStatus(userId: number): Promise<boolean> {
		const [user] = await db
			.select({ totpEnabled: usersTable.totpEnabled })
			.from(usersTable)
			.where(eq(usersTable.id, userId));
		return user?.totpEnabled ?? false;
	}

	/**
	 * Generate 2FA setup data (secret and otpauth URI for QR code)
	 */
	async setupTwoFactor(userId: number): Promise<{ uri: string; secret: string }> {
		const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

		if (!user) {
			throw new Error("User not found");
		}

		if (user.totpEnabled) {
			throw new Error("2FA is already enabled for this account");
		}

		// Generate a new TOTP secret
		const secret = new OTPAuth.Secret({ size: 20 });
		const totp = new OTPAuth.TOTP({
			issuer: "Zerobyte",
			label: user.username,
			algorithm: "SHA1",
			digits: 6,
			period: 30,
			secret: secret,
		});

		return {
			uri: totp.toString(),
			secret: secret.base32,
		};
	}

	/**
	 * Enable 2FA after verifying password and code
	 */
	async enableTwoFactor(userId: number, password: string, secret: string, code: string): Promise<void> {
		const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

		if (!user) {
			throw new Error("User not found");
		}

		if (user.totpEnabled) {
			throw new Error("2FA is already enabled for this account");
		}

		// Verify password
		const isPasswordValid = await Bun.password.verify(password, user.passwordHash);
		if (!isPasswordValid) {
			throw new Error("Invalid password");
		}

		// Verify the code with the provided secret
		const totp = new OTPAuth.TOTP({
			issuer: "Zerobyte",
			label: user.username,
			algorithm: "SHA1",
			digits: 6,
			period: 30,
			secret: OTPAuth.Secret.fromBase32(secret),
		});

		const delta = totp.validate({ token: code, window: 1 });
		if (delta === null) {
			throw new Error("Invalid verification code");
		}

		// Encrypt and save the secret
		const encryptedSecret = await cryptoUtils.sealSecret(secret);

		await db.transaction(async (tx) => {
			await tx
				.update(usersTable)
				.set({
					totpSecret: encryptedSecret,
					totpEnabled: true,
					updatedAt: Date.now(),
				})
				.where(eq(usersTable.id, userId));

			// Invalidate all sessions except current (user will need to re-login on other devices)
			await tx.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
		});

		logger.info(`2FA enabled for user: ${user.username}`);
	}

	/**
	 * Disable 2FA after verifying password and TOTP code
	 */
	async disableTwoFactor(userId: number, password: string, code: string): Promise<void> {
		const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

		if (!user) {
			throw new Error("User not found");
		}

		if (!user.totpEnabled || !user.totpSecret) {
			throw new Error("2FA is not enabled for this account");
		}

		// Verify password
		const isPasswordValid = await Bun.password.verify(password, user.passwordHash);
		if (!isPasswordValid) {
			throw new Error("Invalid password");
		}

		// Decrypt and verify TOTP code
		const decryptedSecret = await cryptoUtils.resolveSecret(user.totpSecret);
		const totp = new OTPAuth.TOTP({
			issuer: "Zerobyte",
			label: user.username,
			algorithm: "SHA1",
			digits: 6,
			period: 30,
			secret: OTPAuth.Secret.fromBase32(decryptedSecret),
		});

		const delta = totp.validate({ token: code, window: 1 });
		if (delta === null) {
			throw new Error("Invalid 2FA code");
		}

		// Disable 2FA
		await db.transaction(async (tx) => {
			await tx
				.update(usersTable)
				.set({
					totpSecret: null,
					totpEnabled: false,
					updatedAt: Date.now(),
				})
				.where(eq(usersTable.id, userId));

			// Invalidate all sessions
			await tx.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
		});

		logger.info(`2FA disabled for user: ${user.username}`);
	}
}

export const authService = new AuthService();
