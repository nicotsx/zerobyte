import type { Effect } from "effect";

export type AgentJob = {
	name: string;
	intervalMs: number;
	run: () => Effect.Effect<void, never, never>;
};
