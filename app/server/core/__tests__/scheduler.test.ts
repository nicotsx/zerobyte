import { afterEach, describe, expect, mock, spyOn, test, vi } from "bun:test";
import { logger } from "~/server/utils/logger";
import { Job, Scheduler } from "../scheduler";

const flushMicrotasks = async () => {
	await Promise.resolve();
};

describe("Scheduler", () => {
	afterEach(async () => {
		await Scheduler.clear();
		mock.restore();
		vi.useRealTimers();
	});

	test("keeps future cron ticks armed while a job is still running", async () => {
		vi.useFakeTimers({ now: new Date("2026-03-08T00:00:00.000Z") });

		let runCount = 0;
		let releaseRun: (() => void) | undefined;
		const warn = spyOn(logger, "warn");

		class TestJob extends Job {
			async run() {
				runCount += 1;
				await new Promise<void>((resolve) => {
					releaseRun = resolve;
				});
			}
		}

		Scheduler.build(TestJob).schedule("* * * * *");

		expect(vi.getTimerCount()).toBe(1);

		vi.advanceTimersByTime(60_000);
		await flushMicrotasks();

		expect(runCount).toBe(1);
		expect(vi.getTimerCount()).toBe(1);

		vi.advanceTimersByTime(60_000);
		await flushMicrotasks();

		expect(runCount).toBe(1);
		expect(warn).toHaveBeenCalledWith("Skipping overlapping run for job TestJob");
		expect(vi.getTimerCount()).toBe(1);

		releaseRun?.();
		await flushMicrotasks();
	});

	test("throws for invalid cron expressions instead of retrying with a fallback timer", () => {
		vi.useFakeTimers({ now: new Date("2026-03-08T00:00:00.000Z") });

		class InvalidCronJob extends Job {
			async run() {
				return;
			}
		}

		expect(() => Scheduler.build(InvalidCronJob).schedule("not a cron")).toThrow();
		expect(vi.getTimerCount()).toBe(0);
	});
});
