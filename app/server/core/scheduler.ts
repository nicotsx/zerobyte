import CronExpressionParser from "cron-parser";
import { logger } from "../utils/logger";

export abstract class Job {
	abstract run(): Promise<unknown>;
}

type JobConstructor = new () => Job;

class ScheduledTask {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private active = true;
	private running = false;
	private readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;

	constructor(
		private readonly jobName: string,
		private readonly cronExpression: string,
		private readonly run: () => Promise<void>,
	) {
		CronExpressionParser.parse(this.cronExpression);
		this.scheduleNext();
	}

	private getDelay(fromDate: Date) {
		const interval = CronExpressionParser.parse(this.cronExpression, {
			currentDate: fromDate,
			tz: this.timeZone,
		});
		const nextRun = interval.next().toDate();
		return Math.max(0, nextRun.getTime() - Date.now());
	}

	private clearTimer() {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private stopScheduling(error: unknown) {
		this.active = false;
		this.clearTimer();
		logger.error(`Stopping scheduled job ${this.jobName} after cron parsing failed:`, error);
	}

	private scheduleNext(fromDate = new Date()) {
		if (!this.active) return;

		const delay = this.getDelay(fromDate);
		this.timer = setTimeout(() => {
			void this.tick();
		}, delay);
	}

	private async tick() {
		if (!this.active) return;
		this.timer = null;

		try {
			this.scheduleNext(new Date());
		} catch (error) {
			this.stopScheduling(error);
			return;
		}

		if (this.running) {
			logger.warn(`Skipping overlapping run for job ${this.jobName}`);
			return;
		}

		this.running = true;
		try {
			await this.run();
		} finally {
			this.running = false;
		}
	}

	async stop() {
		this.active = false;
		this.clearTimer();
	}

	async destroy() {
		await this.stop();
	}
}

class SchedulerClass {
	private tasks: ScheduledTask[] = [];

	async start() {
		logger.info("Scheduler started");
	}

	build(JobClass: JobConstructor) {
		const job = new JobClass();
		return {
			schedule: (cronExpression: string) => {
				const task = new ScheduledTask(JobClass.name, cronExpression, async () => {
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
