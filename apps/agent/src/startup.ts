import path from "node:path";
import { parseAgentToken } from "@zerobyte/contracts/agent-token";
import { Data, Effect } from "effect";
import { toMessage } from "@zerobyte/core/utils";
import { loadConfiguration, readConfiguration, writeConfiguration, type AgentConfiguration } from "./config";
import { enrollMachine, parseControllerUrl, reconnectMachine } from "./enrollment";
import * as fs from "./fs";
import { createTrustedRootRegistry, parseConfiguredRoots } from "./trusted-roots";

class StartupError extends Data.TaggedError("StartupError")<{ message: string }> {}

export const loadStartupConfiguration = (configPath: string, allowInsecure = false) =>
	Effect.gen(function* () {
		const code = process.env.ZEROBYTE_AGENT_ENROLLMENT_CODE;
		if (!code) return yield* loadConfiguration(configPath);

		if (process.env.ZEROBYTE_AGENT_TOKEN) {
			return yield* new StartupError({
				message: "Set either ZEROBYTE_AGENT_ENROLLMENT_CODE or ZEROBYTE_AGENT_TOKEN, not both.",
			});
		}

		const controllerUrl = process.env.ZEROBYTE_CONTROLLER_URL;
		if (!controllerUrl) {
			return yield* new StartupError({ message: "Enrollment requires ZEROBYTE_CONTROLLER_URL." });
		}

		const enrollment = parseAgentToken(code);
		if (!enrollment) {
			return yield* new StartupError({
				message: "ZEROBYTE_AGENT_ENROLLMENT_CODE is not a valid connection code.",
			});
		}

		const controller = yield* parseControllerUrl(controllerUrl, allowInsecure);
		const saved = yield* readConfiguration(configPath).pipe(
			Effect.catchTag("ConfigurationMissing", () => Effect.succeed(undefined)),
		);
		const identity = saved && parseAgentToken(saved.token);

		if (identity?.agentId === enrollment.agentId && identity.credentialVersion > enrollment.credentialVersion) {
			return yield* loadConfiguration(configPath);
		}

		const roots = yield* Effect.try({
			try: () => {
				const configured = process.env.ZEROBYTE_AGENT_ROOTS;
				const roots = configured === undefined ? (saved?.roots ?? []) : parseConfiguredRoots(configured);

				createTrustedRootRegistry({ roots });
				return roots;
			},
			catch: (error) => new StartupError({ message: toMessage(error) }),
		});

		yield* fs.makeDirectory(path.dirname(configPath), 0o700);

		let configuration: AgentConfiguration;
		if (saved) {
			configuration = yield* reconnectMachine(saved, controller, code);
		} else {
			configuration = yield* enrollMachine(controller, code, []);
		}

		yield* writeConfiguration(configPath, { ...configuration, roots });
		return yield* loadConfiguration(configPath);
	});
