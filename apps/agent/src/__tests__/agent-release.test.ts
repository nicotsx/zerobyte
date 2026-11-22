import {
	AGENT_RELEASE_ATTESTATION_ASSET,
	AGENT_RELEASE_ATTESTATION_MAX_BYTES,
	AGENT_RELEASE_EXECUTABLES,
	AGENT_RELEASE_PREDICATE_TYPE,
	agentReleaseAssetUrl,
	verifyAgentReleaseAttestation,
} from "@zerobyte/contracts/agent-release";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { parseAgentReleaseStatement } from "../../../../packages/contracts/src/agent-release-manifest";

const tag = "v1.2.3-beta.1";
const x64 = "a".repeat(64);
const arm64 = "b".repeat(64);
const statement = {
	_type: "https://in-toto.io/Statement/v1",
	predicateType: AGENT_RELEASE_PREDICATE_TYPE,
	predicate: { tag, protocolVersion: 2 },
	subject: [
		{ name: AGENT_RELEASE_EXECUTABLES.x64, digest: { sha256: x64 } },
		{ name: AGENT_RELEASE_EXECUTABLES.arm64, digest: { sha256: arm64 } },
	],
};

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

test("maps the attested architecture hashes and protocol to an update target", () => {
	expect(parseAgentReleaseStatement(encode({ ...statement, subject: statement.subject.toReversed() }), tag)).toEqual({
		formatVersion: 1,
		tag,
		protocolVersion: 2,
		sha256: { x64, arm64 },
	});
});

test.each([
	{ ...statement, predicateType: "https://slsa.dev/provenance/v1" },
	{ ...statement, predicate: { ...statement.predicate, protocolVersion: 0 } },
	{ ...statement, subject: [statement.subject[0], statement.subject[0]] },
	{ ...statement, subject: [{ ...statement.subject[0], digest: { sha256: "invalid" } }, statement.subject[1]] },
])("rejects an invalid agent update statement %#", (invalid) => {
	expect(() => parseAgentReleaseStatement(encode(invalid), tag)).toThrow();
});

test("requires the server's exact release tag", () => {
	expect(() => parseAgentReleaseStatement(encode(statement), "v1.2.3")).toThrow(/does not match/);
});

test("rejects unsigned or oversized metadata before attempting trust discovery", async () => {
	const verify = (payload: Uint8Array) => Effect.runPromise(verifyAgentReleaseAttestation(payload, tag));
	await expect(verify(encode(statement))).rejects.toMatchObject({ _tag: "AgentAttestationInvalid" });
	await expect(verify(new Uint8Array(AGENT_RELEASE_ATTESTATION_MAX_BYTES + 1))).rejects.toMatchObject({
		_tag: "AgentAttestationInvalid",
	});
});

test("constructs only tag-pinned official asset URLs", () => {
	expect(agentReleaseAssetUrl(tag, AGENT_RELEASE_ATTESTATION_ASSET).href).toBe(
		`https://zerobyte.app/agent/${tag}/${AGENT_RELEASE_ATTESTATION_ASSET}`,
	);
	expect(() => agentReleaseAssetUrl("../latest", AGENT_RELEASE_ATTESTATION_ASSET)).toThrow();
});
