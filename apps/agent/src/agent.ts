import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import { Data, Duration, Effect, Schedule } from "effect";
import { ConfigurationUnreadable, type LoadedConfiguration } from "./config";
import { createControllerSession } from "./controller-session";
import { createTrustedRootRegistry, type TrustedRootRegistry } from "./trusted-roots";

const INITIAL_RECONNECT_DELAY = Duration.seconds(1);
const MAX_RECONNECT_DELAY = Duration.seconds(30);

class ConnectionFailed extends Data.TaggedError("ConnectionFailed") {}

export type AgentOptions = {
	configuration: LoadedConfiguration;
	resticVersion: string;
	builtinLocal: boolean;
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
const connectOnce = ({ configuration, resticVersion, builtinLocal }: AgentOptions, trustedRoots: TrustedRootRegistry) =>
	Effect.callback<void, ConnectionFailed>((resume) => {
		const redact = (message: string) => message.replaceAll(configuration.token, "[redacted]").slice(0, 500);

		const ws = new WebSocket(configuration.controllerUrl, {
			headers: { authorization: `Bearer ${configuration.token}` },
		});
		const session = createControllerSession(ws, {
			resticVersion,
			trustedRoots,
			builtinLocal,
			excludedPaths: configuration.configPath ? [configuration.configPath] : [],
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
		const trustedRoots = yield* Effect.try({
			try: () =>
				createTrustedRootRegistry({ roots: options.configuration.roots, builtinLocal: options.builtinLocal }),
			catch: (error) => new ConfigurationUnreadable({ message: toMessage(error) }),
		});

		yield* connectOnce(options, trustedRoots).pipe(
			Effect.retry(afterFailedConnection),
			Effect.repeat(afterSessionEnded),
		);
	});
