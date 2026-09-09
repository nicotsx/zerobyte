import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SERVICE_PATH } from "./system-service";

const VERSION_PATTERN = /^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9][a-zA-Z0-9.-]*)?$/;
const RELEASE_BASE = "https://zerobyte.app/agent";
type FetchRelease = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type UpdateDependencies = {
	arch?: NodeJS.Architecture;
	platform?: NodeJS.Platform;
	uid?: number;
	fetch?: FetchRelease;
	releaseBase?: string;
	runInstaller?: (binary: string) => Promise<void>;
};

const runInstaller = (binary: string) =>
	new Promise<void>((resolve, reject) => {
		const child = spawn(binary, ["install"], {
			stdio: "inherit",
			env: { PATH: SERVICE_PATH, HOME: "/var/lib/zerobyte-agent" },
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0) resolve();
			else {
				const reason = signal ? `signal ${String(signal)}` : `exit ${String(code)}`;
				reject(new Error(`Updated agent installer failed (${reason})`));
			}
		});
	});

const readHttps = async (url: URL, fetchImplementation: FetchRelease) => {
	let currentUrl = url;
	for (let redirect = 0; redirect <= 5; redirect += 1) {
		const response = await fetchImplementation(currentUrl, {
			redirect: "manual",
			signal: AbortSignal.timeout(300_000),
		});

		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location");
			if (!location) throw new Error(`Release redirect did not include a location: ${currentUrl.href}`);

			currentUrl = new URL(location, currentUrl);
			if (currentUrl.protocol !== "https:") throw new Error("Release downloads must remain on HTTPS");

			continue;
		}

		if (!response.ok) throw new Error(`Download failed (${response.status}): ${currentUrl.href}`);
		return new Uint8Array(await response.arrayBuffer());
	}

	throw new Error(`Too many release download redirects: ${url.href}`);
};

export const updateSystemService = async (version: string, dependencies: UpdateDependencies = {}) => {
	if (version !== "latest" && !VERSION_PATTERN.test(version)) {
		throw new Error("Version must be latest or a release tag such as v1.0.0");
	}

	const platform = dependencies.platform ?? process.platform;
	const arch = dependencies.arch ?? process.arch;
	const uid = dependencies.uid ?? process.getuid?.();

	if (platform !== "linux") throw new Error("Agent updates support Linux only");
	if (uid !== 0) throw new Error("Run zerobyte-agent update as root (for example, with sudo)");

	const releaseArch = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : null;
	if (!releaseArch) throw new Error("Agent updates support Linux x64 and ARM64 only");

	const asset = `zerobyte-agent-linux-${releaseArch}`;
	const base = new URL(`${version}/`, `${dependencies.releaseBase ?? RELEASE_BASE}/`);

	if (base.protocol !== "https:") throw new Error("Release downloads require HTTPS");

	const fetchImplementation = dependencies.fetch ?? fetch;

	const [binary, checksumFile] = await Promise.all([
		readHttps(new URL(asset, base), fetchImplementation),
		readHttps(new URL(`${asset}.sha256`, base), fetchImplementation),
	]);
	const checksumText = new TextDecoder().decode(checksumFile).trim();
	const expected = checksumText.split(/\s+/, 1)[0];

	if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error("Release checksum is invalid");

	const actual = createHash("sha256").update(binary).digest("hex");

	if (actual !== expected) throw new Error("Agent checksum mismatch; nothing was installed");

	const directory = await mkdtemp(join(tmpdir(), "zerobyte-agent-update-"));
	const downloadedBinary = join(directory, asset);

	try {
		await writeFile(downloadedBinary, binary, { mode: 0o755 });
		await chmod(downloadedBinary, 0o755);
		await (dependencies.runInstaller ?? runInstaller)(downloadedBinary);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
};
