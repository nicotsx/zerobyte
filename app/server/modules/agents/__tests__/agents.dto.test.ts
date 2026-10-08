import { describe, expect, test } from "vitest";
import { createAgentBody } from "../agents.dto";

describe("createAgentBody", () => {
	test("trims valid machine names and preserves the length boundary", () => {
		const maximumLengthName = "a".repeat(100);
		const parsedName = createAgentBody.parse({ name: `  ${maximumLengthName}  ` }).name;

		expect(parsedName).toBe(maximumLengthName);
	});

	test.each(["archive\u0000node", "archive\u202enode", "\narchive"])(
		"rejects Unicode Cc/Cf characters in %j",
		(name) => {
			expect(createAgentBody.safeParse({ name }).success).toBe(false);
		},
	);
});
