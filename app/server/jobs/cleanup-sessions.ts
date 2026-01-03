import { Job } from "../core/scheduler";
import { authService } from "../modules/auth/auth.service";

export class CleanupSessionsJob extends Job {
	async run() {
		await authService.cleanupExpiredSessions();
		authService.cleanupExpiredPending2faSessions();

		return { done: true, timestamp: new Date() };
	}
}
