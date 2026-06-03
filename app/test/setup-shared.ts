import { vi } from "vitest";
import { Effect } from "effect";

process.env.BASE_URL = "http://localhost:3000";
process.env.TRUSTED_ORIGINS = "http://localhost:3000";

vi.mock(import("@zerobyte/core/node"), async () => {
	const utils = await vi.importActual<typeof import("@zerobyte/core/node")>("@zerobyte/core/node");

	return {
		...utils,
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
	};
});

vi.mock(import("~/server/utils/crypto"), async () => {
	const cryptoModule = await vi.importActual<typeof import("~/server/utils/crypto")>("~/server/utils/crypto");

	return {
		...cryptoModule,
		cryptoUtils: {
			...cryptoModule.cryptoUtils,
			deriveSecret: async () => "test-secret",
			sealSecret: async (v: string) => v,
			resolveSecret: async (v: string) => v,
			generateResticPassword: () => "test-restic-password",
		},
	};
});
