import { describe, expect, test } from "vitest";
import { getControllerUrlForOrigin, getEffectiveMachineStatus } from "../machine-presentation";

describe("machine presentation", () => {
	test("lets revocation override runtime status", () => {
		expect(getEffectiveMachineStatus({ status: "online", revokedAt: 1 })).toBe("revoked");
		expect(getEffectiveMachineStatus({ status: "degraded", revokedAt: null })).toBe("degraded");
	});

	test("derives the public websocket endpoint without credentials", () => {
		expect(getControllerUrlForOrigin("https://backup.example.test")).toBe(
			"wss://backup.example.test/api/v1/agents/connect",
		);
	});
});
