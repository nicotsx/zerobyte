import { db } from "../../db/db";
import { usersTable } from "../../db/schema";

export class AuthService {
	/**
	 * Check if any users exist in the system
	 */
	async hasUsers(): Promise<boolean> {
		const [user] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
		return !!user;
	}
}

export const authService = new AuthService();
