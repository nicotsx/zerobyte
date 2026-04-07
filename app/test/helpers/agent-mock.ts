import { vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import { agentManager } from "~/server/modules/agents/agents-manager";

export const createAgentBackupMocks = (
	resticBackupMock: (params: never) => Promise<{
		exitCode: number;
		summary: string;
		error: string;
		stderr?: string;
	}>,
) => {
	const runningJobs = new Map<string, { scheduleId: string; cancelled: boolean }>();

	const sendBackupMock = vi.fn((_agentId: string, payload: { jobId: string; scheduleId: string }) => {
		const handlers = agentManager.getBackupEventHandlers();

		runningJobs.set(payload.jobId, { scheduleId: payload.scheduleId, cancelled: false });

		handlers.onBackupStarted?.({
			agentId: "local",
			agentName: "local",
			payload: { jobId: payload.jobId, scheduleId: payload.scheduleId },
		});

		void (async () => {
			const stderrLines: string[] = [];
			const result = await resticBackupMock(
				fromAny({
					onStderr: (line: string) => {
						stderrLines.push(line);
					},
				}),
			);
			const running = runningJobs.get(payload.jobId);
			if (!running || running.cancelled) {
				return;
			}

			if (result.exitCode === 0 || result.exitCode === 3) {
				let parsedResult: Record<string, unknown> | null = null;
				if (result.summary) {
					try {
						parsedResult = JSON.parse(result.summary) as Record<string, unknown>;
					} catch {
						parsedResult = null;
					}
				}

				handlers.onBackupCompleted?.({
					agentId: "local",
					agentName: "local",
					payload: {
						jobId: payload.jobId,
						scheduleId: payload.scheduleId,
						exitCode: result.exitCode,
						result: fromAny(parsedResult),
						warningDetails: stderrLines.join("\n") || undefined,
					},
				});
			} else {
				const resultWithStderr = result as typeof result & { stderr?: string };
				const errorDetails = stderrLines.join("\n") || resultWithStderr.stderr || result.error;

				handlers.onBackupFailed?.({
					agentId: "local",
					agentName: "local",
					payload: {
						jobId: payload.jobId,
						scheduleId: payload.scheduleId,
						error: result.error || `Backup failed with code ${result.exitCode}`,
						errorDetails,
					},
				});
			}

			runningJobs.delete(payload.jobId);
		})().catch(() => {});

		return true;
	});

	const cancelBackupMock = vi.fn((_agentId: string, payload: { jobId: string; scheduleId: string }) => {
		const running = runningJobs.get(payload.jobId);
		if (!running) {
			return false;
		}

		running.cancelled = true;
		const handlers = agentManager.getBackupEventHandlers();
		handlers.onBackupCancelled?.({
			agentId: "local",
			agentName: "local",
			payload: {
				jobId: payload.jobId,
				scheduleId: payload.scheduleId,
				message: "Backup was stopped by user",
			},
		});
		runningJobs.delete(payload.jobId);
		return true;
	});

	return { sendBackupMock, cancelBackupMock };
};
