import { logger } from "@zerobyte/core/node";
import { Effect, Fiber } from "effect";
import { CleanupDanglingVolumeMountsJob } from "./cleanup-dangling";
import type { AgentJob } from "./types";

const agentJobs = [CleanupDanglingVolumeMountsJob];

export const startAgentJobs = (jobs: readonly AgentJob[] = agentJobs) => {
	return jobs.map((job) =>
		Effect.runFork(
			Effect.forever(
				Effect.gen(function* () {
					yield* job.run();
					yield* Effect.sleep(job.intervalMs);
				}),
			).pipe(Effect.ensuring(logger.effect.debug(`Agent job stopped: ${job.name}`))),
		),
	);
};

export const stopAgentJobs = (fibers: readonly Fiber.RuntimeFiber<never, never>[]) => {
	return Effect.forEach(fibers, (fiber) => Fiber.interrupt(fiber), { discard: true });
};
