import { expect, test } from "vitest";
import { AGENT_PROTOCOL_VERSION, MAX_AGENT_TRUSTED_ROOTS, parseAgentMessage } from "@zerobyte/contracts/agent-protocol";

const createReadyMessage = (trustedRootCount: number) => {
	const trustedRoots = Array.from({ length: trustedRootCount }, (_, index) => ({
		id: `root-${index}`,
		label: `Location ${index}`,
		canBackup: true,
	}));
	const message = {
		type: "agent.ready",
		payload: {
			agentId: "agent-remote",
			protocolVersion: AGENT_PROTOCOL_VERSION,
			hostname: "archive-node",
			platform: "linux",
			capabilities: { trustedRoots },
		},
	};
	return JSON.stringify(message);
};

test("accepts the canonical maximum trusted-root capability count", () => {
	const message = createReadyMessage(MAX_AGENT_TRUSTED_ROOTS);
	const result = parseAgentMessage(message);

	expect(result?.success).toBe(true);
});

test("rejects a trusted-root capability count above the canonical maximum", () => {
	const oversizedCount = MAX_AGENT_TRUSTED_ROOTS + 1;
	const message = createReadyMessage(oversizedCount);
	const result = parseAgentMessage(message);

	expect(result?.success).toBe(false);
});
