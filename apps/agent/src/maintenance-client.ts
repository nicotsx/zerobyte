import { Data, Effect, Stream } from "effect";
import { fetchScopedHttpResponse } from "@zerobyte/core/node";
import {
	AGENT_MAINTENANCE_MAX_RESPONSE_BYTES,
	AGENT_MAINTENANCE_PATH,
	agentMaintenanceResponseSchema,
	type AgentMaintenanceRequest,
} from "@zerobyte/contracts/agent-maintenance";
import type { LoadedConfiguration } from "./config";
import { UpdateIOError } from "./update-io";

class MaintenanceRejected extends Data.TaggedError("MaintenanceRejected")<{
	message: string;
	status: number;
}> {}

export function maintenanceUrl(controllerUrl: string) {
	const controller = new URL(controllerUrl);
	if (controller.username || controller.password) return null;
	if (controller.protocol !== "https:" && controller.protocol !== "wss:") return null;

	controller.protocol = "https:";
	return new URL(AGENT_MAINTENANCE_PATH, controller.origin);
}

export function createMaintenanceClient(configuration: LoadedConfiguration) {
	const url = maintenanceUrl(configuration.controllerUrl);
	if (!url) return undefined;

	return (request: AgentMaintenanceRequest) =>
		Effect.gen(function* () {
			const { response, body } = yield* fetchScopedHttpResponse(
				(signal) =>
					fetch(url, {
						method: "POST",
						headers: {
							authorization: `Bearer ${configuration.token}`,
							"content-type": "application/json",
						},
						body: JSON.stringify(request),
						redirect: "error",
						tls: { rejectUnauthorized: true },
						signal,
					}),
				AGENT_MAINTENANCE_MAX_RESPONSE_BYTES,
			).pipe(
				Effect.mapError(
					(cause) => new UpdateIOError({ message: "Could not fetch agent maintenance response", cause }),
				),
			);

			if (response.status === 410 && request.action !== "poll" && request.action !== "confirm") {
				return { type: "finalized" } as const;
			}
			if (response.status === 409 || (request.action === "accept" && response.status === 400)) {
				return { type: "pending" } as const;
			}
			if (!response.ok) {
				return yield* new MaintenanceRejected({
					message: `Agent maintenance ${request.action} rejected (HTTP ${response.status})`,
					status: response.status,
				});
			}

			const chunks = yield* Stream.runCollect(body).pipe(
				Effect.mapError(
					(cause) => new UpdateIOError({ message: "Could not read agent maintenance response", cause }),
				),
			);
			const bytes = Buffer.concat(chunks);

			return yield* Effect.try({
				try: () => {
					const json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
					return { type: "response", ...agentMaintenanceResponseSchema.parse(json) } as const;
				},
				catch: (cause) => new UpdateIOError({ message: "Invalid agent maintenance response", cause }),
			});
		}).pipe(Effect.scoped, Effect.timeout("10 seconds"));
}
