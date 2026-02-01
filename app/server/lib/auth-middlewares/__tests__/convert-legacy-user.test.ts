import { test, describe, mock, beforeEach, afterEach, expect } from "bun:test";
import { convertLegacyUserOnFirstLogin } from "../convert-legacy-user";
import { db } from "~/server/db/db";
import { usersTable, account, organization, member } from "~/server/db/schema";
import type { AuthMiddlewareContext } from "../../auth";

describe("convertLegacyUserOnFirstLogin", () => {
	beforeEach(async () => {
		await db.delete(member);
		await db.delete(account);
		await db.delete(organization);
		await db.delete(usersTable);
	});

	afterEach(() => {
		mock.restore();
	});

	const createContext = (path: string, body: Record<string, string>) => ({ path, body }) as AuthMiddlewareContext;

	test("should return early for non-sign-in paths", async () => {
		const ctx = createContext("/sign-up", { username: "test", password: "test" });
		const result = await convertLegacyUserOnFirstLogin(ctx);
		expect(result).toBeUndefined();
	});

	test("should do nothing when no legacy user exists", async () => {
		await db.insert(usersTable).values({
			id: crypto.randomUUID(),
			username: "existing-user",
			email: "existing@test.com",
			name: "Existing User",
			passwordHash: null,
		});

		const ctx = createContext("/sign-in/username", {
			username: "existing-user",
			password: "password123",
		});

		const result = await convertLegacyUserOnFirstLogin(ctx);
		expect(result).toBeUndefined();

		// Verify user still exists with no account
		const user = await db.query.usersTable.findFirst({
			where: { username: "existing-user" },
		});
		expect(user).toBeDefined();
		expect(user?.passwordHash).toBeNull();
	});

	test("should throw UnauthorizedError for invalid password", async () => {
		const hashedPassword = await Bun.password.hash("correct-password");

		// Create a legacy user with a hashed password
		const userId = crypto.randomUUID();
		await db.insert(usersTable).values({
			id: userId,
			username: "legacy-user",
			email: "legacy@test.com",
			name: "Legacy User",
			passwordHash: hashedPassword,
		});

		const ctx = createContext("/sign-in/username", {
			username: "legacy-user",
			password: "wrong-password",
		});

		expect(convertLegacyUserOnFirstLogin(ctx)).rejects.toThrow("Invalid credentials");

		// Verify user still exists (not migrated)
		const user = await db.query.usersTable.findFirst({
			where: { username: "legacy-user" },
		});
		expect(user).toBeDefined();
		expect(user?.passwordHash).toBe(hashedPassword);
	});

	test("should migrate legacy user with existing organization membership", async () => {
		const password = "correct-password";
		const hashedPassword = await Bun.password.hash(password);

		// Create legacy user
		const userId = crypto.randomUUID();
		await db.insert(usersTable).values({
			id: userId,
			username: "legacy-with-org",
			email: "legacy-org@test.com",
			name: "Legacy With Org",
			passwordHash: hashedPassword,
			role: "admin",
		});

		// Create organization and membership
		const orgId = crypto.randomUUID();
		await db.insert(organization).values({
			id: orgId,
			name: "Legacy Org",
			slug: "legacy-org",
			createdAt: new Date(),
		});

		const membershipId = crypto.randomUUID();
		await db.insert(member).values({
			id: membershipId,
			userId: userId,
			organizationId: orgId,
			role: "owner",
			createdAt: new Date(),
		});

		const ctx = createContext("/sign-in/username", {
			username: "legacy-with-org",
			password,
		});

		await convertLegacyUserOnFirstLogin(ctx);

		// Verify old user is deleted
		const oldUser = await db.query.usersTable.findFirst({
			where: { id: userId },
		});
		expect(oldUser).toBeUndefined();

		// Verify new user exists
		const newUser = await db.query.usersTable.findFirst({
			where: { username: "legacy-with-org" },
		});
		expect(newUser).toBeDefined();
		expect(newUser?.email).toBe("legacy-org@test.com");
		expect(newUser?.name).toBe("Legacy With Org");
		expect(newUser?.role).toBe("admin");
		expect(newUser?.passwordHash).toBeNull();
		expect(newUser?.id).not.toBe(userId);

		// Verify account was created
		const userAccount = await db.query.account.findFirst({
			where: { userId: newUser?.id },
		});
		expect(userAccount).toBeDefined();
		expect(userAccount?.providerId).toBe("credential");
		expect(userAccount?.accountId).toBe("legacy-with-org");
		expect(userAccount?.password).toBeDefined();

		// Verify membership was migrated
		const memberships = await db.query.member.findMany({
			where: { userId: newUser?.id },
		});
		expect(memberships.length).toBe(1);
		expect(memberships[0].organizationId).toBe(orgId);
		expect(memberships[0].role).toBe("owner");
	});

	test("should migrate legacy user and create new organization when no membership exists", async () => {
		const password = "correct-password";
		const hashedPassword = await Bun.password.hash(password);

		// Create legacy user without organization membership
		const userId = crypto.randomUUID();
		await db.insert(usersTable).values({
			id: userId,
			username: "legacy-no-org",
			email: "legacy-noorg@test.com",
			name: "Legacy No Org",
			passwordHash: hashedPassword,
			hasDownloadedResticPassword: true,
		});

		const ctx = createContext("/sign-in/username", {
			username: "legacy-no-org",
			password,
		});

		await convertLegacyUserOnFirstLogin(ctx);

		// Verify old user is deleted
		const oldUser = await db.query.usersTable.findFirst({
			where: { id: userId },
		});
		expect(oldUser).toBeUndefined();

		// Verify new user exists
		const newUser = await db.query.usersTable.findFirst({
			where: { username: "legacy-no-org" },
		});
		expect(newUser).toBeDefined();
		expect(newUser?.email).toBe("legacy-noorg@test.com");
		expect(newUser?.hasDownloadedResticPassword).toBe(true);
		expect(newUser?.role).toBe("admin");

		// Verify account was created
		const userAccount = await db.query.account.findFirst({
			where: { userId: newUser?.id },
		});
		expect(userAccount).toBeDefined();

		// Verify new organization was created
		const memberships = await db.query.member.findMany({
			where: { userId: newUser?.id },
		});
		expect(memberships.length).toBe(1);
		expect(memberships[0].role).toBe("owner");

		const org = await db.query.organization.findFirst({
			where: { id: memberships[0].organizationId },
		});
		expect(org).toBeDefined();
		expect(org?.name).toBe("Legacy No Org's Workspace");
		expect(org?.metadata).toBeDefined();
	});

	test("should be case-insensitive for username", async () => {
		const password = "correct-password";
		const hashedPassword = await Bun.password.hash(password);

		const userId = crypto.randomUUID();
		await db.insert(usersTable).values({
			id: userId,
			username: "legacy-user",
			email: "legacy@test.com",
			name: "Legacy User",
			passwordHash: hashedPassword,
		});

		// Try login with uppercase username
		const ctx = createContext("/sign-in/username", {
			username: "LEGACY-USER",
			password,
		});

		await convertLegacyUserOnFirstLogin(ctx);

		// Verify migration happened
		const oldUser = await db.query.usersTable.findFirst({
			where: { id: userId },
		});
		expect(oldUser).toBeUndefined();

		const newUser = await db.query.usersTable.findFirst({
			where: { username: "legacy-user" },
		});
		expect(newUser).toBeDefined();
	});

	test("should trim whitespace from username", async () => {
		const password = "correct-password";
		const hashedPassword = await Bun.password.hash(password);

		const userId = crypto.randomUUID();
		await db.insert(usersTable).values({
			id: userId,
			username: "legacy-user",
			email: "legacy@test.com",
			name: "Legacy User",
			passwordHash: hashedPassword,
		});

		// Try login with whitespace
		const ctx = createContext("/sign-in/username", {
			username: "  legacy-user  ",
			password,
		});

		await convertLegacyUserOnFirstLogin(ctx);

		// Verify migration happened
		const oldUser = await db.query.usersTable.findFirst({
			where: { id: userId },
		});
		expect(oldUser).toBeUndefined();

		const newUser = await db.query.usersTable.findFirst({
			where: { username: "legacy-user" },
		});
		expect(newUser).toBeDefined();
	});
});
