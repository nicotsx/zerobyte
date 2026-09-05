import "./setup-shared";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { client } from "~/client/api-client/client.gen";
import { server } from "~/test/msw/server";

vi.mock(import("~/client/hooks/use-root-loader-data"), () => {
	const now = Date.now();
	return {
		useRootLoaderData: () => ({
			locale: "en-US",
			timeZone: "UTC",
			dateFormat: "MM/DD/YYYY",
			timeFormat: "12h",
			now,
		}),
	};
});

client.setConfig({
	baseUrl: "http://localhost:3000",
	credentials: "include",
});

beforeAll(() => {
	server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
	server.resetHandlers();
});

afterAll(() => {
	server.close();
});
