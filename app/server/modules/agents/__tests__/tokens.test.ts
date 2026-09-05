import { expect, test } from "vitest";
import { createEnrollmentToken, parseEnrollmentToken } from "../helpers/tokens";

test("enrollment tokens are versioned, indexed, and backed by a fixed-size keyed digest", async () => {
	const agentId = "019fe196-890d-7000-aa75-f958d70b8a96";
	const credentials = await createEnrollmentToken(agentId, 7);
	const parsed = parseEnrollmentToken(credentials.token);

	expect(parsed).toMatchObject({ agentId, credentialVersion: 7 });
	expect(parsed?.secret).toHaveLength(32);
	expect(credentials.credentialHash).toMatch(/^[a-f0-9]{64}$/);
	expect(credentials.credentialHash).not.toContain(parsed?.secret.toString("base64url") ?? "missing");
	expect(credentials.credentialHash).not.toContain(credentials.token);
});

test.each([
	"",
	"zba2.YWdlbnQ.1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	"zba1.YWdlbnQ.01.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	"zba1.YWdlbnQ.-1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	"zba1.YWdlbnQ.2147483648.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	"zba1.***.1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	"zba1.YWdlbnQ.1.short",
	"zba1.YWdlbnQ.1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.extra",
])("strictly rejects malformed enrollment token %j", (token) => {
	expect(parseEnrollmentToken(token)).toBeNull();
});

test("new credentials use independent 256-bit random secrets", async () => {
	const first = await createEnrollmentToken("agent-1", 1);
	const second = await createEnrollmentToken("agent-1", 1);
	expect(first.token).not.toBe(second.token);
	expect(first.credentialHash).not.toBe(second.credentialHash);
});
