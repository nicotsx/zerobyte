import cron, { type ScheduledTask } from "node-cron";
import { logger } from "../utils/logger";

export abstract class Job {
	abstract run(): Promise<unknown>;
}

type JobConstructor = new () => Job;

class SchedulerClass {
	private tasks: ScheduledTask[] = [];

	async start() {
		logger.info("Scheduler started");
	}

	build(JobClass: JobConstructor) {
		const job = new JobClass();
		return {
			schedule: (cronExpression: string) => {
				const task = cron.schedule(cronExpression, async () => {
					try {
						await job.run();
					} catch (error) {
						logger.error(`Job ${JobClass.name} failed:`, error);
					}
				});

				this.tasks.push(task);
				logger.info(`Scheduled job ${JobClass.name} with cron: ${cronExpression}`);
			},
		};
	}

	async stop() {
		for (const task of this.tasks) {
			await task.stop();
		}
		this.tasks = [];
		logger.info("Scheduler stopped");
	}

	async clear() {
		for (const task of this.tasks) {
			await task.destroy();
		}
		this.tasks = [];
		logger.info("Scheduler cleared all tasks");
	}
}

export const Scheduler = new SchedulerClass();
