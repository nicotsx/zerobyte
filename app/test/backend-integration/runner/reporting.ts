export type StageReport = {
	name: string;
	status: "passed" | "failed";
	durationMs: number;
	error?: string;
};

export type ScenarioReport = {
	id: string;
	volumeBackend: string;
	repositoryBackend: string;
	status: "passed" | "failed";
	durationMs: number;
	stages: StageReport[];
	snapshotId?: string;
	error?: string;
};

export type IntegrationReport = {
	runId: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	passed: number;
	failed: number;
	scenarios: ScenarioReport[];
};

export function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

function log(message: string): void {
	process.stdout.write(`${message}\n`);
}

export function logScenario(scenarioId: string, message: string): void {
	log(`[${scenarioId}] ${message}`);
}

function formatDuration(durationMs: number): string {
	if (durationMs < 1000) {
		return `${durationMs}ms`;
	}

	if (durationMs < 10_000) {
		return `${(durationMs / 1000).toFixed(1)}s`;
	}

	return `${(durationMs / 1000).toFixed(0)}s`;
}

function formatScenarioResult(scenario: ScenarioReport, labelWidth: number): string {
	const status = scenario.status === "passed" ? "✔︎ PASS" : "⨯ FAIL";
	const id = scenario.id.padEnd(labelWidth);
	return `${status} ${id}  ${formatDuration(scenario.durationMs)}  ${scenario.volumeBackend} -> ${scenario.repositoryBackend}`;
}

export function printRunSummary(report: IntegrationReport): void {
	const labelWidth = report.scenarios.reduce((max, scenario) => Math.max(max, scenario.id.length), 4);

	log("");
	log("Scenario Results");

	for (const scenario of report.scenarios) {
		log(formatScenarioResult(scenario, labelWidth));

		const failedStage = scenario.stages.find((stage) => stage.status === "failed");
		if (failedStage?.error) {
			log(`     ${failedStage.name}: ${failedStage.error}`);
		}
	}

	log("");
	log(
		`${report.failed === 0 ? "PASS" : "FAIL"} ${report.passed}/${report.scenarios.length} scenarios passed in ${formatDuration(report.durationMs)} (run ${report.runId})`,
	);
}
