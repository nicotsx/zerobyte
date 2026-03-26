import "./setup.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeAll } from "bun:test";
import { client } from "~/client/api-client/client.gen";
import { server } from "~/test/msw/server";

GlobalRegistrator.register({ url: "http://localhost:3000" });

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
