import { BadRequestError, NotFoundError } from "http-errors-enhanced";
import { logger } from "@zerobyte/core/node";
import type { RetentionPolicy } from "@zerobyte/core/restic";
import type { Repository } from "../../../db/schema";
import { restic } from "../../../core/restic";
import { repoMutex } from "../../../core/repository-mutex";
import { cache, cacheKeys } from "../../../utils/cache";
import { runEffectPromise } from "../../../utils/errors";
import { getOrganizationId } from "~/server/core/request-context";
import { repositoryQueries, scheduleQueries } from "../backups.queries";

type ForgetExecutionPlan = {
	repository: Repository;
	retentionPolicy: RetentionPolicy;
	tag: string;
	organizationId: string;
	signal?: AbortSignal;
};

export async function executeForget(plan: ForgetExecutionPlan) {
	logger.info(`running retention policy (forget) for repository ${plan.repository.id}`);
	const releaseLock = await repoMutex.acquireExclusive(plan.repository.id, `forget:${plan.tag}`, plan.signal);

	try {
		await runEffectPromise(
			restic.forget(plan.repository.config, plan.retentionPolicy, {
				tag: plan.tag,
				organizationId: plan.organizationId,
				signal: plan.signal,
			}),
		);
		cache.delByPrefix(cacheKeys.repository.all(plan.repository.id));
	} finally {
		releaseLock();
	}

	logger.info(`Retention policy applied successfully for repository ${plan.repository.id}`);
}

export async function runForget(
	scheduleId: number,
	repositoryId?: string,
	organizationIdOverride?: string,
	signal?: AbortSignal,
) {
	const organizationId = organizationIdOverride ?? getOrganizationId();
	const schedule = await scheduleQueries.findById(scheduleId, organizationId);

	if (!schedule) {
		throw new NotFoundError("Backup schedule not found");
	}

	if (!schedule.retentionPolicy) {
		throw new BadRequestError("No retention policy configured for this schedule");
	}

	const repository = await repositoryQueries.findById(repositoryId ?? schedule.repositoryId, organizationId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	await executeForget({
		repository,
		retentionPolicy: schedule.retentionPolicy,
		tag: schedule.shortId,
		organizationId,
		signal,
	});
}
