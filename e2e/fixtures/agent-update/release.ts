import { createPublicKey, verify } from "node:crypto";
import { Data, Effect } from "effect";
import { parseAgentReleaseStatement } from "../../../packages/contracts/src/agent-release-manifest";

export class AgentAttestationInvalid extends Data.TaggedError("AgentAttestationInvalid")<{ cause: unknown }> {}
export class AgentReleaseTrustUnavailable extends Data.TaggedError("AgentReleaseTrustUnavailable")<{
	cause: unknown;
}> {}

export const fixtureReleaseOrigin = "http://127.0.0.1:4097";

export const fetchAgentReleaseAsset = (url: URL, signal: AbortSignal) =>
	fetch(new URL(url.pathname, fixtureReleaseOrigin), { redirect: "error", signal });

export function createFixtureVerifier(publicKey: string) {
	const key = createPublicKey(publicKey);

	return (bytes: Uint8Array, tag: string) =>
		Effect.try({
			try: () => {
				const statement = bytes.subarray(64);
				if (!verify(null, statement, key, bytes.subarray(0, 64))) {
					throw new Error("Invalid fixture release signature");
				}

				return parseAgentReleaseStatement(statement, tag);
			},
			catch: (cause) => new AgentAttestationInvalid({ cause }),
		});
}
