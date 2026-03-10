import { afterEach, describe, expect, mock, spyOn, test, vi } from "bun:test";
import { logger } from "@zerobyte/core/utils";
import { Job, Scheduler } from "../scheduler";

const flushMicrotasks = async () => {
	await Promise.resolve();
};

const mockTimeZone = (timeZone: string) => {
	// oxlint-disable-next-line typescript/unbound-method
	const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
	return spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(
		function (this: Intl.DateTimeFormat) {
			return { ...resolvedOptions.call(this), timeZone };
		},
	);
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

	test("uses the local timezone instead of UTC when arming the next run", async () => {
		mockTimeZone("America/New_York");
		vi.useFakeTimers({ now: new Date("2026-01-15T04:59:00.000Z") });

		let runCount = 0;

		class MidnightJob extends Job {
			async run() {
				runCount += 1;
			}
		}

		Scheduler.build(MidnightJob).schedule("0 0 * * *");

		vi.advanceTimersByTime(59_000);
		await flushMicrotasks();
		expect(runCount).toBe(0);

		vi.advanceTimersByTime(1_000);
		await flushMicrotasks();
		expect(runCount).toBe(1);
	});

	test("runs skipped-hour cron expressions once when daylight saving time jumps forward", async () => {
		mockTimeZone("America/New_York");
		vi.useFakeTimers({ now: new Date("2026-03-08T06:59:00.000Z") });

		let runCount = 0;

		class SpringForwardJob extends Job {
			async run() {
				runCount += 1;
			}
		}

		Scheduler.build(SpringForwardJob).schedule("0 2 * * *");

		vi.advanceTimersByTime(60_000);
		await flushMicrotasks();
		expect(runCount).toBe(1);
		expect(vi.getTimerCount()).toBe(1);

		vi.advanceTimersByTime(60_000);
		await flushMicrotasks();
		expect(runCount).toBe(1);
	});

	test("does not run the same repeated local time twice when daylight saving time falls back", async () => {
		mockTimeZone("America/New_York");
		vi.useFakeTimers({ now: new Date("2026-11-01T05:20:00.000Z") });

		let runCount = 0;

		class FallBackJob extends Job {
			async run() {
				runCount += 1;
			}
		}

		Scheduler.build(FallBackJob).schedule("30 1 * * *");

		vi.advanceTimersByTime(10 * 60_000);
		await flushMicrotasks();
		expect(runCount).toBe(1);

		vi.advanceTimersByTime(70 * 60_000);
		await flushMicrotasks();
		expect(runCount).toBe(1);
		expect(vi.getTimerCount()).toBe(1);
	});
});
