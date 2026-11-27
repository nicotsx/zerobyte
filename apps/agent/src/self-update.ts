import { randomUUID } from "node:crypto";
import { AGENT_PROTOCOL_VERSION } from "@zerobyte/contracts/agent-protocol";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import { Clock, Duration, Effect, Exit, Schedule } from "effect";
import type { LoadedConfiguration } from "./config";
import { clearLocalUpdate, readLocalUpdateState, saveUpdateAttempt, stagedUpdatePath } from "./local-update-state";
import { createMaintenanceClient } from "./maintenance-client";
import {
	acceptSystemdTrial,
	commitSystemdUpdate,
	currentAgentVersion,
	SYSTEMD_STARTUP_TIMEOUT_MS,
	TRIAL_FINALIZATION_RESERVE_MS,
	type ManagedSystemd,
} from "./systemd-update";
import type { UpdateJobs } from "./update-jobs";
import { matchesUpdateTarget, stageUpdate } from "./update-release";

export const confirmUpdateTrial = (
	service: ManagedSystemd,
	configuration: LoadedConfiguration,
	startupStartedAt: bigint,
) =>
	Effect.gen(function* () {
		const maintenance = createMaintenanceClient(configuration);
		const state = readLocalUpdateState(service.directory);
		if (!maintenance || state.phase !== "trial") {
			return yield* Effect.fail(
				new Error("Missing or invalid agent update trial", {
					cause: state.phase === "invalid" ? state.error : undefined,
				}),
			);
		}

		const now = yield* Clock.monotonicTimeNanos;
		const elapsedMs = Duration.toMillis(Duration.nanos(now - startupStartedAt));
		const remainingMs = SYSTEMD_STARTUP_TIMEOUT_MS - elapsedMs;
		const confirmationMs = remainingMs - TRIAL_FINALIZATION_RESERVE_MS;
		const startupTimeout = Effect.fail(new Error("Agent update trial ran out of systemd startup time"));

		if (confirmationMs <= 0) return yield* startupTimeout;

		const { requestId, attemptId, target, failed } = state.attempt;
		const confirmationInterval = Schedule.spaced("1 second");

		yield* maintenance({ action: "confirm", requestId, attemptId }).pipe(
			Effect.retry({
				schedule: confirmationInterval,
				while: (error) => error._tag !== "MaintenanceRejected" || error.status >= 500 || error.status === 429,
			}),
			Effect.repeat({
				schedule: confirmationInterval,
				until: (result) => result.type === "response" && result.update === null,
			}),
			Effect.timeoutOrElse({ duration: confirmationMs, orElse: () => startupTimeout }),
			Effect.andThen(
				Effect.try(() => {
					// The restored executable must still be able to read attempt.json if notification fails.
					saveUpdateAttempt(service.directory, { requestId, attemptId, target, failed }, "confirmed");
				}),
			),
			Effect.andThen(acceptSystemdTrial(service)),
			Effect.timeoutOrElse({ duration: remainingMs, orElse: () => startupTimeout }),
		);
	});

export const runSelfUpdate = (service: ManagedSystemd, configuration: LoadedConfiguration, jobs: UpdateJobs) =>
	Effect.gen(function* () {
		const maintenance = createMaintenanceClient(configuration);
		const version = currentAgentVersion();
		const arch = process.arch;
		if (!maintenance || !version || (arch !== "x64" && arch !== "arm64")) return;

		const { directory } = service;
		const staged = stagedUpdatePath(directory);
		let stagedAttempt: string | undefined;

		const reset = Effect.try(() => {
			clearLocalUpdate(directory);
			stagedAttempt = undefined;
		});

		const report = (
			action: "accept" | "fail" | "failPreparation",
			{ requestId, attemptId }: { requestId: string; attemptId: string },
		) =>
			Effect.gen(function* () {
				const response = yield* maintenance({ action, requestId, attemptId });
				if (response.type === "finalized" || (response.type === "response" && response.update === null)) {
					yield* reset;
				}
			});

		const fenced = Effect.acquireRelease(
			Effect.sync(() => jobs.beginCommit()),
			(acquired, exit) =>
				Effect.sync(() => {
					if (acquired && !(Exit.isSuccess(exit) && exit.value === true)) jobs.cancelCommit();
				}),
		);

		const poll = Effect.gen(function* () {
			const state = readLocalUpdateState(directory);
			switch (state.phase) {
				case "invalid":
					yield* logger.effect.warn(`Systemd agent update unavailable: ${toMessage(state.error)}`);
					return yield* Effect.never;
				case "trial":
					return;
				case "rolled-back":
					return yield* report("fail", state.attempt);
				case "accepted":
					return yield* report("accept", state.attempt);
			}

			const response = yield* maintenance({ action: "poll" });
			if (response.type !== "response") return;

			const { update } = response;
			let attempt = state.phase === "attempt" ? state.attempt : undefined;
			if (!update || attempt?.requestId !== update.requestId) {
				if (attempt || (state.phase === "idle" && state.staged)) yield* reset;
				attempt = undefined;
			}
			if (!update || (!attempt && update.status === "started")) return;

			if (!attempt) {
				const initialAttempt = {
					requestId: update.requestId,
					attemptId: randomUUID(),
					target: update.target,
					failed: false,
				};

				yield* Effect.try(() => saveUpdateAttempt(directory, initialAttempt));
				attempt = initialAttempt;
			}

			const { requestId, attemptId, target } = attempt;
			if (!matchesUpdateTarget(update.target, target)) return;
			if (target.tag === version && target.protocolVersion === AGENT_PROTOCOL_VERSION) return;

			const recordFailure = (phase: string, error: unknown) =>
				Effect.try(() => {
					saveUpdateAttempt(directory, { requestId, attemptId, target, failed: true });
					logger.warn(`Agent update ${phase} failed: ${toMessage(error)}`);
				});

			const reportFailure = report(update.status === "queued" ? "failPreparation" : "fail", attempt);
			if (attempt.failed) return yield* reportFailure;

			if (stagedAttempt !== attemptId) {
				const stagedSuccessfully = yield* stageUpdate(target, version, arch, staged).pipe(
					Effect.as(true),
					Effect.catch((error) => recordFailure("preparation", error).pipe(Effect.as(false))),
				);
				if (!stagedSuccessfully) return yield* reportFailure;

				stagedAttempt = attemptId;
			}

			return yield* Effect.gen(function* () {
				if (!(yield* fenced)) return;

				const response = yield* maintenance({ action: "start", requestId, attemptId });
				if (response.type === "finalized") return yield* reset;
				if (response.type !== "response") return;

				const accepted = response.update;
				if (accepted?.status !== "started" || accepted.requestId !== requestId) return;
				if (!matchesUpdateTarget(accepted.target, target)) return;

				return yield* Effect.try(() => commitSystemdUpdate(service, staged)).pipe(
					Effect.as(true as const),
					Effect.catch((error) => recordFailure("activation", error)),
				);
			}).pipe(Effect.scoped);
		});

		return yield* poll.pipe(
			Effect.catch((error) => logger.effect.warn(`Agent update maintenance failed: ${toMessage(error)}`)),
			Effect.repeat({ schedule: Schedule.spaced("15 seconds"), until: (committed) => committed === true }),
		);
	});
