import { logger } from "@zerobyte/core/node";
import type { RetentionPolicy } from "@zerobyte/core/restic";
import type { Repository } from "../../../db/schema";
import { restic } from "../../../core/restic";
import { repoMutex } from "../../../core/repository-mutex";
import { cache, cacheKeys } from "../../../utils/cache";
import { runEffectPromise } from "../../../utils/errors";

type ForgetExecutionPlan = {
	repository: Repository;
	retentionPolicy: RetentionPolicy;
	tag: string;
	organizationId: string;
	signal?: AbortSignal;
};

export async function applyRetentionPolicy(plan: ForgetExecutionPlan) {
	logger.info(`running retention policy (forget) for repository ${plan.repository.id}`);
	await runEffectPromise(
		restic.forget(plan.repository.config, plan.retentionPolicy, {
			tag: plan.tag,
			organizationId: plan.organizationId,
			signal: plan.signal,
		}),
	);
	cache.delByPrefix(cacheKeys.repository.all(plan.repository.id));

	logger.info(`Retention policy applied successfully for repository ${plan.repository.id}`);
}

export async function executeForget(plan: ForgetExecutionPlan) {
	const releaseLock = await repoMutex.acquireExclusive(plan.repository.id, `forget:${plan.tag}`, plan.signal);

	try {
		await applyRetentionPolicy(plan);
	} finally {
		releaseLock();
	}
}
