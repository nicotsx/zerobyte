import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_PROTOCOL_VERSION, type AgentCapabilities } from "@zerobyte/contracts/agent-protocol";
import { agentReleaseManifestSchema } from "@zerobyte/contracts/agent-release";
import { z } from "zod";
import { currentAgentVersion, syncDirectory } from "./systemd-update";

const attemptSchema = z.object({
	requestId: z.uuid(),
	attemptId: z.uuid(),
	target: agentReleaseManifestSchema,
	failed: z.boolean(),
	confirmed: z.literal(true).optional(),
});

type UpdateAttempt = z.infer<typeof attemptSchema>;

type LocalUpdateState =
	| { phase: "idle"; staged: boolean }
	| { phase: "attempt" | "trial" | "rolled-back" | "accepted"; attempt: UpdateAttempt }
	| { phase: "invalid"; trial: boolean; error: unknown };

export const stagedUpdatePath = (directory: string) => join(directory, "staged");

function readRecord(path: string) {
	return existsSync(path) ? attemptSchema.parse(JSON.parse(readFileSync(path, "utf8"))) : undefined;
}

export function readLocalUpdateState(directory: string): LocalUpdateState {
	const trial = existsSync(join(directory, "trial"));

	try {
		const attempt = readRecord(join(directory, "attempt.json"));
		const rolledBack = existsSync(join(directory, "failed"));
		const receiptPath = join(directory, "confirmed.json");

		if (!attempt) {
			if (trial || rolledBack || existsSync(receiptPath)) throw new Error("Missing agent update attempt");

			return { phase: "idle", staged: existsSync(stagedUpdatePath(directory)) };
		}

		if (rolledBack && !trial) return { phase: "rolled-back", attempt };

		const currentBuild =
			attempt.target.tag === currentAgentVersion() && attempt.target.protocolVersion === AGENT_PROTOCOL_VERSION;
		if (trial && (!currentBuild || attempt.failed || rolledBack)) {
			throw new Error("Trial agent does not match the requested build");
		}

		const receipt = readRecord(receiptPath);
		const confirmed =
			attempt.confirmed || (receipt?.requestId === attempt.requestId && receipt.attemptId === attempt.attemptId);
		const recorded = confirmed ? { ...attempt, confirmed: true as const } : attempt;

		if (trial) return { phase: "trial", attempt: recorded };
		if (confirmed && currentBuild && !attempt.failed) return { phase: "accepted", attempt: recorded };

		return { phase: "attempt", attempt: recorded };
	} catch (error) {
		return { phase: "invalid", trial, error };
	}
}

export function getLocalUpdateTrial(state: LocalUpdateState): AgentCapabilities["updateTrial"] {
	if (state.phase !== "trial" && state.phase !== "accepted") return undefined;

	const { requestId, attemptId } = state.attempt;
	if (state.phase === "trial") return { requestId, attemptId };

	return { requestId, attemptId, locallyAccepted: true };
}

export function saveUpdateAttempt(
	directory: string,
	state: UpdateAttempt,
	record: "attempt" | "confirmed" = "attempt",
) {
	const temporary = join(directory, `${record}.tmp`);
	rmSync(temporary, { force: true });
	const fd = openSync(temporary, "wx", 0o600);
	try {
		writeFileSync(fd, JSON.stringify(state));
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}

	renameSync(temporary, join(directory, `${record}.json`));
	syncDirectory(directory);
}

export function clearLocalUpdate(directory: string) {
	const rolledBack = join(directory, "failed");
	rmSync(stagedUpdatePath(directory), { force: true });
	rmSync(join(directory, "confirmed.json"), { force: true });
	if (existsSync(rolledBack)) {
		rmSync(rolledBack);
		syncDirectory(directory);
	}
	rmSync(join(directory, "attempt.json"), { force: true });
	syncDirectory(directory);
}
