import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { AGENT_PROTOCOL_VERSION } from "@zerobyte/contracts/agent-protocol";
import {
	AGENT_RELEASE_ATTESTATION_ASSET,
	AGENT_RELEASE_EXECUTABLES,
	AGENT_RELEASE_PREDICATE_TYPE,
} from "../../packages/contracts/src/agent-release-manifest";

const repo = resolve(import.meta.dir, "../..");
const target = "v1.0.1-e2e";
const initial = "v1.0.0-e2e";
const container = `zerobyte-agent-update-${randomUUID().slice(0, 8)}`;
const image = "zerobyte-agent-update-e2e";
const temporary = await mkdtemp(join(tmpdir(), "zerobyte-agent-update-e2e-"));
const source = join(temporary, "source");
const fixture = join(temporary, "fixture");

async function run(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; capture?: boolean } = {}) {
	const child = Bun.spawn(args, {
		cwd: options.cwd ?? repo,
		env: { ...process.env, ...options.env },
		stdout: options.capture ? "pipe" : "inherit",
		stderr: "inherit",
	});
	const output = child.stdout ? await new Response(child.stdout).text() : "";
	const status = await child.exited;
	if (status !== 0) throw new Error(`${args.slice(0, 2).join(" ")} exited with status ${status}`);

	return output;
}

async function buildFixture(arch: keyof typeof AGENT_RELEASE_EXECUTABLES) {
	const files = await run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { capture: true });
	for (const file of new Set(files.split("\0").filter(Boolean))) {
		const destination = join(source, file);
		await mkdir(dirname(destination), { recursive: true });
		await copyFile(join(repo, file), destination);
	}

	await mkdir(fixture);
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const pem = publicKey.export({ type: "spki", format: "pem" });
	await writeFile(
		join(source, "packages/contracts/src/agent-release.ts"),
		`
export * from "./agent-release-manifest";
export { fetchAgentReleaseAsset, AgentAttestationInvalid, AgentReleaseTrustUnavailable } from "../../../e2e/fixtures/agent-update/release";
import { createFixtureVerifier } from "../../../e2e/fixtures/agent-update/release";

export const verifyAgentReleaseAttestation = createFixtureVerifier(${JSON.stringify(pem)});
`,
	);

	await run(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], { cwd: source });
	await run(["bun", "run", "build"], {
		cwd: source,
		env: { APP_VERSION: target, VITE_APP_VERSION: target },
	});

	const oldBinary = join(fixture, "zerobyte-agent-old");
	const executable = AGENT_RELEASE_EXECUTABLES[arch];
	const releaseDir = join(fixture, "assets", "agent", target);
	await mkdir(releaseDir, { recursive: true });
	const newBinary = join(releaseDir, executable);
	for (const [version, output] of [
		[initial, oldBinary],
		[target, newBinary],
	]) {
		await run(["bun", "run", "build:agent", `--target=bun-linux-${arch}`, `--outfile=${output}`], {
			cwd: source,
			env: { ZEROBYTE_AGENT_VERSION: version },
		});
	}

	const digest = createHash("sha256")
		.update(await readFile(newBinary))
		.digest("hex");
	const statement = Buffer.from(
		JSON.stringify({
			_type: "https://in-toto.io/Statement/v1",
			predicateType: AGENT_RELEASE_PREDICATE_TYPE,
			predicate: { tag: target, protocolVersion: AGENT_PROTOCOL_VERSION },
			subject: Object.values(AGENT_RELEASE_EXECUTABLES).map((name) => ({
				name,
				digest: { sha256: name === executable ? digest : "0".repeat(64) },
			})),
		}),
	);
	await writeFile(
		join(releaseDir, AGENT_RELEASE_ATTESTATION_ASSET),
		Buffer.concat([sign(null, statement, privateKey), statement]),
	);
	await run([
		"openssl",
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-days",
		"1",
		"-subj",
		"/CN=127.0.0.1",
		"-addext",
		"subjectAltName=IP:127.0.0.1",
		"-keyout",
		join(fixture, "tls.key"),
		"-out",
		join(fixture, "tls.pem"),
	]);

	await rename(join(source, ".output"), join(fixture, ".output"));
	await rename(join(source, "app/drizzle"), join(fixture, "migrations"));
	await copyFile(join(repo, "e2e/fixtures/agent-update/Caddyfile"), join(fixture, "Caddyfile"));

	return digest;
}

let started = false;
try {
	const architecture = (await run(["docker", "info", "--format", "{{.Architecture}}"], { capture: true })).trim();
	const arch =
		architecture === "aarch64" || architecture === "arm64" ? "arm64" : architecture === "x86_64" ? "x64" : null;
	if (!arch) throw new Error(`Unsupported Docker architecture: ${architecture}`);

	const [release, imageBuild] = await Promise.allSettled([
		buildFixture(arch),
		run(["docker", "build", "-t", image, join(repo, "e2e/fixtures/agent-update")]),
	]);
	if (release.status === "rejected") throw release.reason;
	if (imageBuild.status === "rejected") throw imageBuild.reason;

	const digest = release.value;

	await run([
		"docker",
		"run",
		"-d",
		"--rm",
		"--name",
		container,
		"--privileged",
		"--cgroupns=private",
		"--tmpfs",
		"/run",
		"-p",
		"127.0.0.1::8443",
		"-v",
		`${fixture}:/e2e:ro`,
		image,
	]);
	started = true;

	const address = (await run(["docker", "port", container, "8443/tcp"], { capture: true })).trim();
	const origin = `https://${address}`;
	await run([
		"docker",
		"exec",
		"-d",
		"--workdir",
		"/e2e",
		container,
		"sh",
		"-ec",
		`export BASE_URL="$1" APP_VERSION="$2" APP_SECRET="$3" NODE_ENV=production ENABLE_REMOTE_AGENTS=true TRUST_PROXY=true
		 export ZEROBYTE_DATABASE_URL=/var/lib/zerobyte/e2e.db PORT=4096 NITRO_HOST=127.0.0.1 MIGRATIONS_PATH=/e2e/migrations
		 bun .output/server/index.mjs >/var/log/zerobyte-e2e.log 2>&1`,
		"controller",
		origin,
		target,
		randomUUID(),
	]);

	await run([
		"docker",
		"exec",
		"-d",
		container,
		"caddy",
		"run",
		"--config",
		"/e2e/Caddyfile",
		"--adapter",
		"caddyfile",
	]);

	await run([
		"docker",
		"exec",
		"-d",
		container,
		"rest-server",
		"--listen",
		"127.0.0.1:8000",
		"--no-auth",
		"--path",
		"/var/lib/zerobyte/rest-server",
	]);

	await run(["bunx", "--bun", "playwright", "test", "--project", "agent-update"], {
		env: {
			PLAYWRIGHT_HTML_OPEN: "never",
			E2E_AGENT_UPDATE_ORIGIN: origin,
			E2E_AGENT_UPDATE_CONTAINER: container,
			E2E_AGENT_UPDATE_INITIAL: initial,
			E2E_AGENT_UPDATE_TARGET: target,
			E2E_AGENT_UPDATE_DIGEST: digest,
		},
	});
} catch (error) {
	if (started) {
		await run(["docker", "exec", container, "tail", "-n", "80", "/var/log/zerobyte-e2e.log"]).catch(() => {});
		await run(["docker", "exec", container, "journalctl", "-u", "zerobyte-agent", "-n", "80", "--no-pager"]).catch(
			() => {},
		);
	}
	throw error;
} finally {
	if (started) await run(["docker", "rm", "-f", container]).catch(() => {});
	await rm(temporary, { recursive: true, force: true });
}
