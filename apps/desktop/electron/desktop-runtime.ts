import { app } from "electron";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { toMessage } from "@zerobyte/core/utils";

type DesktopDirs = {
	dataDir: string;
	resticCacheDir: string;
	repositoriesDir: string;
	volumesDir: string;
	appSecret: string;
};

export type DesktopRuntime = {
	url: string;
	launchSecret: string;
	stop: () => void;
};

const ownerOnlyDirMode = 0o700;
const ownerOnlyFileMode = 0o600;

const chmodIfSupported = async (targetPath: string, mode: number) => {
	if (process.platform !== "win32") {
		await fs.chmod(targetPath, mode);
	}
};

const ensureFileSecret = async (filePath: string) => {
	try {
		const existing = await fs.readFile(filePath, "utf-8");
		if (existing.trim().length >= 32) {
			await chmodIfSupported(filePath, ownerOnlyFileMode);
			return existing.trim();
		}
	} catch {
		await fs.mkdir(path.dirname(filePath), { recursive: true, mode: ownerOnlyDirMode });
		await chmodIfSupported(path.dirname(filePath), ownerOnlyDirMode);
	}

	const secret = crypto.randomBytes(32).toString("hex");
	await fs.writeFile(filePath, secret, { encoding: "utf-8", mode: ownerOnlyFileMode });
	await chmodIfSupported(filePath, ownerOnlyFileMode);
	return secret;
};

const ensureDesktopDirs = async (): Promise<DesktopDirs> => {
	const userData = app.getPath("userData");
	const dataDir = path.join(userData, "data");
	const resticDir = path.join(userData, "restic");
	const resticCacheDir = path.join(resticDir, "cache");
	const repositoriesDir = path.join(userData, "repositories");
	const volumesDir = path.join(userData, "volumes");

	await Promise.all(
		[dataDir, resticDir, resticCacheDir, repositoriesDir, volumesDir].map(async (dir) => {
			await fs.mkdir(dir, { recursive: true, mode: ownerOnlyDirMode });
			await chmodIfSupported(dir, ownerOnlyDirMode);
		}),
	);

	return {
		dataDir,
		resticCacheDir,
		repositoriesDir,
		volumesDir,
		appSecret: await ensureFileSecret(path.join(dataDir, "app.secret")),
	};
};

const getAvailablePort = () =>
	new Promise<number>((resolve, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			server.close(() => {
				if (typeof address === "object" && address?.port) {
					resolve(address.port);
					return;
				}

				reject(new Error("Failed to allocate a local port"));
			});
		});
	});

const createServerEnv = (port: number, dirs: DesktopDirs, serverUrl: string, launchSecret: string) => ({
	...process.env,
	SERVER_IP: "127.0.0.1",
	PORT: String(port),
	BASE_URL: serverUrl,
	TRUSTED_ORIGINS: serverUrl,
	APP_SECRET: dirs.appSecret,
	APP_VERSION: app.getVersion(),
	ZEROBYTE_RUNTIME: "desktop",
	ZEROBYTE_DESKTOP_LAUNCH_SECRET: launchSecret,
	ZEROBYTE_DATABASE_URL: path.join(dirs.dataDir, "zerobyte.db"),
	RESTIC_PASS_FILE: path.join(dirs.dataDir, "restic.pass"),
	RESTIC_CACHE_DIR: dirs.resticCacheDir,
	ZEROBYTE_REPOSITORIES_DIR: dirs.repositoriesDir,
	ZEROBYTE_VOLUMES_DIR: dirs.volumesDir,
	ENABLE_LOCAL_AGENT: "false",
	DISABLE_RATE_LIMITING: "true",
});

const waitForServer = async (serverUrl: string) => {
	const deadline = Date.now() + 60_000;
	let lastError = "";

	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${serverUrl}/api/healthcheck`, { signal: AbortSignal.timeout(5_000) });
			if (response.ok) {
				return;
			}
			lastError = `${response.status} ${response.statusText}`;
		} catch (error) {
			lastError = toMessage(error);
		}

		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	throw new Error(`Timed out waiting for Zerobyte server: ${lastError}`);
};

export const startDesktopRuntime = async (
	onUnexpectedExit: (status: string | number) => void,
): Promise<DesktopRuntime> => {
	const port = await getAvailablePort();
	const dirs = await ensureDesktopDirs();
	const url = `http://127.0.0.1:${port}`;
	const launchSecret = crypto.randomBytes(32).toString("hex");
	const repoRoot = process.env.ZEROBYTE_REPO_ROOT ?? path.resolve(process.cwd(), "../..");
	let stopped = false;

	const serverProcess = spawn("bunx", ["--bun", "vite", "--host", "127.0.0.1", "--port", String(port)], {
		cwd: repoRoot,
		env: createServerEnv(port, dirs, url, launchSecret),
		stdio: "pipe",
	});

	const handleServerExit = (code: number | null, signal: NodeJS.Signals | null) => {
		if (!stopped) {
			onUnexpectedExit(signal ?? code ?? "unknown status");
		}
	};

	try {
		serverProcess.stdout.on("data", (data) => process.stdout.write(`[zerobyte] ${data}`));
		serverProcess.stderr.on("data", (data) => process.stderr.write(`[zerobyte] ${data}`));
		serverProcess.once("exit", handleServerExit);

		await waitForServer(url);

		return {
			url,
			launchSecret,
			stop: () => {
				stopped = true;
				serverProcess.kill("SIGTERM");
			},
		};
	} catch (error) {
		stopped = true;
		serverProcess.off("exit", handleServerExit);
		serverProcess.kill("SIGTERM");
		throw error;
	}
};
