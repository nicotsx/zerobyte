import { vi } from "vitest";
import { fromAny, fromPartial } from "@total-typescript/shoehorn";
import type { SafeSpawnParams } from "@zerobyte/core/node";
import type { BackupExecutionResult } from "~/server/modules/agents/agents-manager";

export const createAgentBackupMocks = (
	resticBackupMock: (params: SafeSpawnParams) => Promise<{
		exitCode: number;
		summary: string;
		error: string;
		stderr?: string;
	}>,
) => {
	const runningBackups = new Map<number, { resolve: (result: BackupExecutionResult) => void; cancelled: boolean }>();

	const runBackupMock = vi.fn(
		async (_agentId: string, request: { scheduleId: number; payload: { jobId: string }; signal: AbortSignal }) => {
			return new Promise<BackupExecutionResult>((resolve) => {
				runningBackups.set(request.scheduleId, { resolve, cancelled: false });

				request.signal.addEventListener(
					"abort",
					() => {
						const running = runningBackups.get(request.scheduleId);
						if (!running || running.cancelled) {
							return;
						}

						running.cancelled = true;
						runningBackups.delete(request.scheduleId);
						resolve({ status: "cancelled" });
					},
					{ once: true },
				);

				void (async () => {
					const stderrLines: string[] = [];
					const result = await resticBackupMock(
						fromPartial<SafeSpawnParams>({
							signal: request.signal,
							onStderr: (line: string) => {
								stderrLines.push(line);
							},
						}),
					);
					const running = runningBackups.get(request.scheduleId);
					if (!running || running.cancelled) {
						return;
					}

					runningBackups.delete(request.scheduleId);

					if (result.exitCode === 0 || result.exitCode === 3) {
						let parsedResult: Record<string, unknown> | null = null;
						if (result.summary) {
							try {
								parsedResult = JSON.parse(result.summary) as Record<string, unknown>;
							} catch {
								parsedResult = null;
							}
						}

						resolve({
							status: "completed",
							exitCode: result.exitCode,
							result: fromAny(parsedResult),
							warningDetails: stderrLines.join("\n") || null,
						});
						return;
					}

					const resultWithStderr = result as typeof result & { stderr?: string };
					resolve({
						status: "failed",
						error: stderrLines.join("\n") || resultWithStderr.stderr || result.error,
					});
				})().catch((err) => {
					runningBackups.delete(request.scheduleId);
					resolve({ status: "failed", error: String(err) });
				});
			});
		},
	);

	const cancelBackupMock = vi.fn(async (_agentId: string, scheduleId: number) => {
		const running = runningBackups.get(scheduleId);
		if (!running) {
			return false;
		}

		running.cancelled = true;
		runningBackups.delete(scheduleId);
		running.resolve({ status: "cancelled" });
		return true;
	});

	return { runBackupMock, cancelBackupMock };
};
