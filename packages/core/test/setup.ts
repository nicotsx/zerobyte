import { mock } from "bun:test";

void mock.module("../src/utils/logger.ts", () => ({
	logger: {
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {},
	},
}));
