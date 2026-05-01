import { vi } from "vitest";
import { Effect } from "effect";

vi.mock(import("../src/node/logger.ts"), () => ({
	logger: {
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
		effect: {
			debug: () => Effect.void,
			info: () => Effect.void,
			warn: () => Effect.void,
			error: () => Effect.void,
		},
	},
}));
