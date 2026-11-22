import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { AGENT_PROTOCOL_VERSION } from "@zerobyte/contracts/agent-protocol";
import {
	AGENT_RELEASE_ATTESTATION_ASSET,
	AGENT_RELEASE_ATTESTATION_MAX_BYTES,
	AGENT_RELEASE_EXECUTABLES,
	verifyAgentReleaseAttestation,
} from "@zerobyte/contracts/agent-release";
import { Effect } from "effect";

const [tag, directory] = Bun.argv.slice(2);
if (!tag || !directory) throw new Error("Usage: bun scripts/check-agent-attestation.ts <tag> <directory>");

const bundle = Bun.file(join(directory, AGENT_RELEASE_ATTESTATION_ASSET));
if (bundle.size > AGENT_RELEASE_ATTESTATION_MAX_BYTES) throw new Error("Agent release attestation exceeds size limit");

const release = await Effect.runPromise(verifyAgentReleaseAttestation(await bundle.bytes(), tag));
if (release.protocolVersion !== AGENT_PROTOCOL_VERSION)
	throw new Error("Agent release protocol version does not match");

for (const arch of ["x64", "arm64"] as const) {
	const name = AGENT_RELEASE_EXECUTABLES[arch];
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(join(directory, name))) hash.update(chunk);
	if (hash.digest("hex") !== release.sha256[arch]) throw new Error(`Attested digest does not match ${name}`);
}
