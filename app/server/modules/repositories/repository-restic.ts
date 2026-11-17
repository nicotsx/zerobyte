import { Effect } from "effect";
import { ServiceUnavailableError } from "http-errors-enhanced";
import type { RepositoryConfig } from "@zerobyte/core/restic";
import type { ResticCommand } from "@zerobyte/contracts/agent-protocol";
import { restic, resticDeps } from "../../core/restic";
import { agentManager } from "../agents/agents-manager";
import { AGENT_OFFLINE_MESSAGE, LOCAL_AGENT_ID } from "../agents/constants";
import { toMessage } from "../../utils/errors";
import { decryptRepositoryConfig } from "./repository-config-secrets";

type ResticMethod =
	| "init"
	| "snapshots"
	| "ls"
	| "check"
	| "forget"
	| "deleteSnapshots"
	| "tagSnapshots"
	| "unlock"
	| "repairIndex"
	| "stats"
	| "copy";

type ResticResult<Method extends ResticMethod> = Effect.Success<ReturnType<(typeof restic)[Method]>>;

type ResticCall<Method extends ResticMethod> = (
	...args: Parameters<(typeof restic)[Method]>
) => Effect.Effect<ResticResult<Method>, Error>;

/**
 * The restic operations a repository can run. Repositories owned by the built-in agent run locally; repositories
 * owned by a remote machine run on that machine, which holds the storage.
 */
export type RepositoryRestic = { [Method in ResticMethod]: ResticCall<Method> };

type ResticRunOptions = { signal?: AbortSignal; onMessage?: (message: string) => void };

const fromPromise = <A>(run: () => Promise<A>) =>
	Effect.tryPromise({ try: run, catch: (error) => new Error(toMessage(error)) });

const hasOwnPassword = (repositoryConfig: RepositoryConfig) =>
	repositoryConfig.isExistingRepository && !!repositoryConfig.customPassword;

/**
 * The runtime password restic falls back to for every config without its own password. The organization password
 * is only resolved, and so only leaves the server, when one of the configs needs it. Configs must already be decrypted.
 */
export const resolveRepositoryRuntimePassword = async (
	organizationId: string,
	repositoryConfig: RepositoryConfig,
	...otherConfigs: RepositoryConfig[]
) => {
	const ownPassword = repositoryConfig.isExistingRepository ? repositoryConfig.customPassword : undefined;
	if (ownPassword && otherConfigs.every(hasOwnPassword)) {
		return ownPassword;
	}

	const encryptedResticPassword = await resticDeps.getOrganizationResticPassword(organizationId);
	return resticDeps.resolveSecret(encryptedResticPassword);
};

const decryptConfig = (config: RepositoryConfig) => fromPromise(() => decryptRepositoryConfig(config));

const sendToAgent = <Success>(
	agentId: string,
	organizationId: string,
	repositoryConfig: RepositoryConfig,
	command: ResticCommand,
	options: ResticRunOptions,
) =>
	Effect.gen(function* () {
		// Custom repository passwords travel inside the decrypted configs (source and copy destination); the runtime
		// password is the fallback for every config without one.
		const configs = command.name === "restic.copy" ? [command.destinationConfig] : [];
		const password = yield* fromPromise(() =>
			resolveRepositoryRuntimePassword(organizationId, repositoryConfig, ...configs),
		);

		return yield* agentManager.runResticCommand<Success>(agentId, {
			organizationId,
			repositoryConfig,
			runtime: { password },
			command,
			signal: options.signal,
			onMessage: options.onMessage,
		});
	});

const runOnAgent = <Success>(
	agentId: string,
	config: RepositoryConfig,
	organizationId: string,
	command: ResticCommand,
	options: ResticRunOptions,
) =>
	decryptConfig(config).pipe(
		Effect.flatMap((repositoryConfig) =>
			sendToAgent<Success>(agentId, organizationId, repositoryConfig, command, options),
		),
	);

const createAgentRestic = (agentId: string): RepositoryRestic => ({
	init: (config, options) =>
		runOnAgent(agentId, config, options.organizationId, { name: "restic.init", timeoutMs: options.timeoutMs }, {}),
	snapshots: (config, options) =>
		runOnAgent(agentId, config, options.organizationId, { name: "restic.snapshots", tags: options.tags }, options),
	ls: (config, snapshotId, path, options) =>
		runOnAgent(
			agentId,
			config,
			options.organizationId,
			{ name: "restic.ls", snapshotId, path, offset: options.offset, limit: options.limit },
			{},
		),
	check: (config, options) =>
		runOnAgent(
			agentId,
			config,
			options.organizationId,
			{ name: "restic.check", readData: options.readData },
			options,
		),
	forget: (config, retentionPolicy, options) =>
		runOnAgent(
			agentId,
			config,
			options.organizationId,
			{ name: "restic.forget", retentionPolicy, tag: options.tag, dryRun: options.dryRun },
			options,
		),
	deleteSnapshots: (config, snapshotIds, options) =>
		runOnAgent(agentId, config, options.organizationId, { name: "restic.deleteSnapshots", snapshotIds }, {}),
	tagSnapshots: (config, snapshotIds, tags, options) =>
		runOnAgent(agentId, config, options.organizationId, { name: "restic.tagSnapshots", snapshotIds, tags }, {}),
	unlock: (config, options) =>
		runOnAgent(
			agentId,
			config,
			options.organizationId,
			{ name: "restic.unlock", removeAll: options.removeAll },
			options,
		),
	repairIndex: (config, options) =>
		runOnAgent(agentId, config, options.organizationId, { name: "restic.repairIndex" }, options),
	stats: (config, options) => runOnAgent(agentId, config, options.organizationId, { name: "restic.stats" }, {}),
	copy: (sourceConfig, destinationConfig, options) =>
		Effect.gen(function* () {
			const repositoryConfig = yield* decryptConfig(sourceConfig);
			const destination = yield* decryptConfig(destinationConfig);

			return yield* sendToAgent<ResticResult<"copy">>(
				agentId,
				options.organizationId,
				repositoryConfig,
				{
					name: "restic.copy",
					destinationConfig: destination,
					tag: options.tag,
					snapshotIds: options.snapshotIds,
					customResticParams: options.customResticParams,
				},
				options,
			);
		}),
});

/** Restic operations for repositories stored on the given agent. The built-in agent's repositories run locally. */
export const resticForAgent = (agentId: string): RepositoryRestic =>
	agentId === LOCAL_AGENT_ID ? restic : createAgentRestic(agentId);

/** Whether repository work can run now. Repositories stored on the built-in agent always can. */
export const isRepositoryMachineOnline = (agentId: string) =>
	agentId === LOCAL_AGENT_ID || agentManager.isAgentReady(agentId);

/** Rejects work that must run on a remote machine before the machine is ready to receive it. */
export const assertAgentOnline = (agentId: string) => {
	if (!isRepositoryMachineOnline(agentId)) {
		throw new ServiceUnavailableError(AGENT_OFFLINE_MESSAGE);
	}
};
