import { runDbMigrations } from "../../db/db";
import { startAgentController, startLocalAgent, stopAgentController } from "../agents/agents-manager";
import { agentsService } from "../agents/agents.service";
import { enqueueApplicationLifecycleTransition, getApplicationLifecycleRuntime } from "./bootstrap-runtime";
import { runMigrations } from "./migrations";
import { startup } from "./startup";

const runBootstrap = async () => {
	const bootstrapStartedAt = Date.now();
	await runDbMigrations();
	await runMigrations();
	await agentsService.ensureLocalAgent();
	await agentsService.markStaleRemoteAgentsOffline();

	try {
		await startAgentController();

		await startLocalAgent();

		await startup(bootstrapStartedAt);
	} catch (error) {
		await stopAgentController();
		throw error;
	}
};

export const bootstrapApplication = () => {
	getApplicationLifecycleRuntime().shutdownPromise = null;

	return enqueueApplicationLifecycleTransition(async (runtime, generation) => {
		if (runtime.status === "running") {
			runtime.completedGeneration = generation;
			return;
		}

		runtime.status = "starting";
		try {
			await runBootstrap();
			runtime.status = "running";
		} catch (error) {
			runtime.status = "stopped";
			throw error;
		} finally {
			runtime.completedGeneration = generation;
		}
	});
};
