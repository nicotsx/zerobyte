import { vi } from "vitest";

vi.mock(import("../src/utils/logger.ts"), () => ({
	logger: {
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
	},
}));
