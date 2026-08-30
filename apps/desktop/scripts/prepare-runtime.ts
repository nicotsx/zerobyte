import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopDir, "../..");
const runtimeDir = path.join(repoRoot, "tmp", "desktop", "zerobyte-runtime");
const downloadsDir = path.join(repoRoot, "node_modules", ".cache", "zerobyte-desktop");
const binDir = path.join(runtimeDir, "bin");

type RuntimeAssets = Record<"bun" | "restic" | "shoutrrr", (version: string) => string>;

const assetNamesByTarget: Record<string, RuntimeAssets | undefined> = {
	"darwin-arm64": {
		bun: () => "bun-darwin-aarch64.zip",
		restic: (version: string) => `restic_${version}_darwin_arm64.bz2`,
		shoutrrr: (version: string) => `shoutrrr_macOS_arm64v8_${version}.tar.gz`,
	},
	"linux-x64": {
		bun: () => "bun-linux-x64.zip",
		restic: (version: string) => `restic_${version}_linux_amd64.bz2`,
		shoutrrr: (version: string) => `shoutrrr_linux_amd64_${version}.tar.gz`,
	},
	"win32-x64": {
		bun: () => "bun-windows-x64.zip",
		restic: (version: string) => `restic_${version}_windows_amd64.zip`,
		shoutrrr: (version: string) => `shoutrrr_windows_amd64_${version}.zip`,
	},
};

const args = parseArgs({ options: { platform: { type: "string" }, arch: { type: "string" } } }).values as {
	platform?: string;
	arch?: string;
};

const platform = args.platform ?? process.env.ZEROBYTE_DESKTOP_TARGET_PLATFORM ?? process.platform;
const arch = args.arch ?? process.env.ZEROBYTE_DESKTOP_TARGET_ARCH ?? process.arch;
const targetName = `${platform}-${arch}`;
const assetNames = assetNamesByTarget[targetName];
const executableExtension = platform === "win32" ? ".exe" : "";
const bunExecutableName = `bun${executableExtension}`;
const resticExecutableName = `restic${executableExtension}`;
const shoutrrrExecutableName = `shoutrrr${executableExtension}`;

if (!assetNames) {
	throw new Error(
		`Desktop runtime preparation has no asset mapping for ${targetName}. Supported targets: ${Object.keys(assetNamesByTarget).join(", ")}.`,
	);
}

const run = async (command: string, args: string[], cwd = repoRoot) => {
	const proc = Bun.spawn([command, ...args], {
		cwd,
		env: { ...process.env, VITE_GIT_HOOKS: "0" },
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed with exit code ${exitCode}`);
	}
};

const readDockerArg = async (name: string) => {
	const dockerfile = await fs.readFile(path.join(repoRoot, "Dockerfile"), "utf-8");
	const match = dockerfile.match(new RegExp(`^ARG ${name}="([^"]+)"`, "m"));

	if (!match?.[1]) {
		throw new Error(`Could not find ${name} in Dockerfile`);
	}

	return match[1];
};

const download = async (url: string, destination: string) => {
	await fs.mkdir(path.dirname(destination), { recursive: true });

	try {
		if ((await fs.stat(destination)).size > 0) {
			return;
		}
	} catch {}

	console.info(`Downloading ${path.basename(destination)}`);
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
	}

	await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
};

const chmodExecutable = async (filePath: string) => {
	if (process.platform !== "win32") {
		await fs.chmod(filePath, 0o755);
	}
};

const installExecutable = async (source: string, destinationName = path.basename(source)) => {
	const destination = path.join(binDir, destinationName);
	await fs.copyFile(source, destination);
	await chmodExecutable(destination);
};

const installBzip2Executable = async (archivePath: string, destinationName: string) => {
	const destination = path.join(binDir, destinationName);
	const proc = Bun.spawn(["bzip2", "-dc", archivePath], {
		stdout: "pipe",
		stderr: "inherit",
	});

	await fs.writeFile(destination, Buffer.from(await new Response(proc.stdout).arrayBuffer()));

	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`bzip2 failed with exit code ${exitCode}`);
	}

	await chmodExecutable(destination);
};

const extractZip = async (archivePath: string, extractDir: string) => {
	if (process.platform === "win32") {
		await run("tar", ["-xf", archivePath, "-C", extractDir], desktopDir);
		return;
	}

	await run("unzip", ["-oq", archivePath, "-d", extractDir], desktopDir);
};

const copyIfExists = async (source: string, destination: string) => {
	try {
		await fs.cp(source, destination, { recursive: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}
};

const stageApp = async () => {
	await run("bun", ["run", "build"]);

	await fs.rm(runtimeDir, { recursive: true, force: true });
	await fs.mkdir(binDir, { recursive: true });
	await fs.cp(path.join(repoRoot, ".output"), path.join(runtimeDir, ".output"), { recursive: true });
	await fs.cp(path.join(repoRoot, "app", "drizzle"), path.join(runtimeDir, "assets", "migrations"), {
		recursive: true,
	});
	await fs.copyFile(path.join(repoRoot, "package.json"), path.join(runtimeDir, "package.json"));
	await copyIfExists(path.join(repoRoot, "LICENSE"), path.join(runtimeDir, "LICENSE.md"));
	await copyIfExists(path.join(repoRoot, "NOTICES.md"), path.join(runtimeDir, "NOTICES.md"));
	await copyIfExists(path.join(repoRoot, "LICENSES"), path.join(runtimeDir, "LICENSES"));
};

const stageBun = async () => {
	const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf-8")) as {
		packageManager?: string;
	};
	const version = packageJson.packageManager?.match(/^bun@(.+)$/)?.[1];
	if (!version) {
		throw new Error("Root package.json must pin packageManager to bun@<version>");
	}

	const releaseUrl = `https://github.com/oven-sh/bun/releases/download/bun-v${version}`;
	const assetName = assetNames.bun(version);
	const archivePath = path.join(downloadsDir, `bun-${version}-${assetName}`);
	const extractDir = path.join(downloadsDir, `bun-${version}-${targetName}`);

	await download(`${releaseUrl}/${assetName}`, archivePath);
	await fs.rm(extractDir, { recursive: true, force: true });
	await fs.mkdir(extractDir, { recursive: true });
	await extractZip(archivePath, extractDir);
	await installExecutable(
		path.join(extractDir, path.basename(assetName, ".zip"), bunExecutableName),
		bunExecutableName,
	);
};

const stageRestic = async () => {
	const version = await readDockerArg("RESTIC_VERSION");
	const releaseUrl = `https://github.com/restic/restic/releases/download/v${version}`;
	const assetName = assetNames.restic(version);
	const archivePath = path.join(downloadsDir, `restic-${version}-${assetName}`);

	await download(`${releaseUrl}/${assetName}`, archivePath);
	if (assetName.endsWith(".zip")) {
		const extractDir = path.join(downloadsDir, `restic-${version}-${targetName}`);
		await fs.rm(extractDir, { recursive: true, force: true });
		await fs.mkdir(extractDir, { recursive: true });
		await extractZip(archivePath, extractDir);
		const extractedExecutableName = `${path.basename(assetName, ".zip")}${executableExtension}`;
		await installExecutable(path.join(extractDir, extractedExecutableName), resticExecutableName);
		return;
	}

	await installBzip2Executable(archivePath, resticExecutableName);
};

const stageShoutrrr = async () => {
	const version = await readDockerArg("SHOUTRRR_VERSION");
	const releaseUrl = `https://github.com/nicholas-fedor/shoutrrr/releases/download/v${version}`;
	const assetName = assetNames.shoutrrr(version);
	const archivePath = path.join(downloadsDir, `shoutrrr-${version}-${assetName}`);
	const extractDir = path.join(downloadsDir, `shoutrrr-${version}-${targetName}`);

	await download(`${releaseUrl}/${assetName}`, archivePath);
	await fs.rm(extractDir, { recursive: true, force: true });
	await fs.mkdir(extractDir, { recursive: true });
	if (assetName.endsWith(".zip")) {
		await extractZip(archivePath, extractDir);
	} else {
		await run("tar", ["-xzf", archivePath, "-C", extractDir], desktopDir);
	}
	await installExecutable(path.join(extractDir, shoutrrrExecutableName), shoutrrrExecutableName);
};

console.info(`Preparing desktop runtime for ${targetName}`);
await fs.mkdir(downloadsDir, { recursive: true });
await stageApp();
await stageBun();
await stageRestic();
await stageShoutrrr();
