import type { AgentCapabilities } from "@zerobyte/contracts/agent-protocol";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import { Data, Duration, Effect, Schedule } from "effect";
import { ConfigurationUnreadable, type LoadedConfiguration } from "./config";
import { createControllerSession } from "./controller-session";
import { createTrustedRootRegistry, type TrustedRootRegistry } from "./trusted-roots";
import { createUpdateJobs, type UpdateJobs } from "./update-jobs";
import { confirmUpdateTrial, runSelfUpdate } from "./self-update";
import { getLocalUpdateTrial, readLocalUpdateState } from "./local-update-state";
import { canUpdateSystemd, notifySystemdReady, type ManagedSystemd } from "./systemd-update";
import { maintenanceUrl } from "./maintenance-client";
import { SERVICE_CONFIG } from "./service-paths";

const INITIAL_RECONNECT_DELAY = Duration.seconds(1);
const MAX_RECONNECT_DELAY = Duration.seconds(30);

class ConnectionFailed extends Data.TaggedError("ConnectionFailed") {}

export type AgentOptions = {
	configuration: LoadedConfiguration;
	resticVersion: string;
	builtinLocal: boolean;
	managedService?: ManagedSystemd & { startupStartedAt: bigint };
};

const announced = <In>(schedule: Schedule.Schedule<unknown, In>) =>
	schedule.pipe(
		Schedule.tap(({ duration }) =>
			Effect.sync(() => logger.info(`Reconnecting to controller in ${Math.ceil(Duration.toSeconds(duration))}s`)),
		),
	);

const afterFailedConnection = announced(
	Schedule.min([Schedule.exponential(INITIAL_RECONNECT_DELAY), Schedule.spaced(MAX_RECONNECT_DELAY)]).pipe(
		Schedule.jittered,
	),
);

const afterSessionEnded = announced(Schedule.spaced(INITIAL_RECONNECT_DELAY).pipe(Schedule.jittered));

/**
 * Succeeds when an established session ends and fails when the socket closes before opening. Retrying only
 * failures lets backoff restart from its initial delay once a connection has been accepted.
 */
const connectOnce = (
	{ configuration, resticVersion, builtinLocal, managedService }: AgentOptions,
	trustedRoots: TrustedRootRegistry,
	updateJobs?: UpdateJobs,
	updateTrial?: AgentCapabilities["updateTrial"],
) =>
	Effect.callback<void, ConnectionFailed>((resume) => {
		const redact = (message: string) => message.replaceAll(configuration.token, "[redacted]").slice(0, 500);

		const ws = new WebSocket(configuration.controllerUrl, {
			headers: { authorization: `Bearer ${configuration.token}` },
		});
		const session = createControllerSession(ws, {
			resticVersion,
			trustedRoots,
			builtinLocal,
			updateJobs,
			updateTrial,
			excludedPaths: [
				...(configuration.configPath ? [configuration.configPath] : []),
				...(managedService ? [managedService.directory] : []),
			],
		});
		let opened = false;

		ws.onopen = () => {
			opened = true;
			logger.info("Agent connected to controller");
			session.onOpen();
		};

		ws.onmessage = (event) => session.onMessage(event.data);

		ws.onerror = (event) => {
			const message = redact((event as ErrorEvent)?.message || "No error details provided");

			logger.error(`Agent websocket connection failed: ${message}`);

			if (message.includes("Expected 101 status code")) {
				logger.error(
					"Controller rejected the WebSocket upgrade. Check controller logs and proxy forwarding of WebSocket upgrades, Authorization, and X-Forwarded-Proto: https. A trusted TLS proxy also requires TRUST_PROXY=true on the controller.",
				);
			}
		};

		ws.onclose = (event) => {
			session.close();
			logger.info(
				`Agent disconnected from controller (${event?.code ?? 1006}: ${redact(event?.reason || "No close reason provided")})`,
			);
			resume(opened ? Effect.void : Effect.fail(new ConnectionFailed()));
		};

		return Effect.sync(() => {
			ws.onopen = null;
			ws.onmessage = null;
			ws.onerror = null;
			ws.onclose = null;
			session.close();
			ws.close(1000, "agent_shutdown");
		});
	});

export const runAgent = (options: AgentOptions) =>
	Effect.gen(function* () {
		if (!options.builtinLocal && new URL(options.configuration.controllerUrl).protocol === "ws:") {
			yield* logger.effect.warn(
				"Insecure HTTP connection to controller: credentials and controller traffic are sent without TLS. Use HTTPS/WSS to secure this connection.",
			);
		}

		const trustedRoots = yield* Effect.try({
			try: () =>
				createTrustedRootRegistry({ roots: options.configuration.roots, builtinLocal: options.builtinLocal }),
			catch: (error) => new ConfigurationUnreadable({ message: toMessage(error) }),
		});

		const { managedService, configuration } = options;
		const connect = (jobs?: UpdateJobs, getTrial?: () => AgentCapabilities["updateTrial"]) =>
			Effect.suspend(() => connectOnce(options, trustedRoots, jobs, getTrial?.())).pipe(
				Effect.retry(afterFailedConnection),
				Effect.repeat(afterSessionEnded),
			);

		const state = managedService ? readLocalUpdateState(managedService.directory) : undefined;
		if (state?.phase === "invalid" && state.trial) {
			return yield* Effect.fail(new Error("Invalid agent update trial", { cause: state.error }));
		}
		const trial = state?.phase === "trial";
		if (!trial) yield* notifySystemdReady;
		if (!managedService) return yield* connect();
		if (state?.phase === "invalid") {
			yield* logger.effect.warn(`Systemd agent update unavailable: ${toMessage(state.error)}`);
			return yield* connect();
		}

		const eligible = yield* Effect.try(
			() =>
				configuration.configPath === SERVICE_CONFIG &&
				!process.env.ZEROBYTE_AGENT_ENROLLMENT_CODE &&
				Boolean(maintenanceUrl(configuration.controllerUrl)) &&
				canUpdateSystemd(managedService),
		).pipe(
			Effect.catch((error) =>
				logger.effect.warn(`Systemd agent update unavailable: ${toMessage(error)}`).pipe(Effect.as(false)),
			),
		);

		if (!eligible) {
			if (trial) return yield* Effect.fail(new Error("Agent update trial is no longer eligible"));
			return yield* connect();
		}

		const getTrial = () => getLocalUpdateTrial(readLocalUpdateState(managedService.directory));

		const jobs = createUpdateJobs();
		if (trial) jobs.beginCommit();

		const confirmTrial = confirmUpdateTrial(managedService, configuration, managedService.startupStartedAt).pipe(
			Effect.tap(() => Effect.sync(() => jobs.cancelCommit())),
		);

		return yield* Effect.raceFirst(
			connect(jobs, getTrial),
			(trial ? confirmTrial : Effect.void).pipe(
				Effect.andThen(runSelfUpdate(managedService, configuration, jobs)),
			),
		).pipe(Effect.ensuring(jobs.close));
	});
