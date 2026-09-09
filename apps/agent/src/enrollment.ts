import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import { lock } from "proper-lockfile";
import { homedir } from "node:os";
import * as path from "node:path";
import { createTrustedRootRegistry } from "./trusted-roots";

export type AgentConfiguration = { controllerUrl: string; token: string; roots: string; allowInsecure?: boolean };

export const defaultConfigPath = () => path.join(homedir(), ".config", "zerobyte-agent", "agent.json");

const readEnrollmentError = async (response: Response) => {
	if (!response.headers.get("content-type")?.includes("application/json")) return null;

	try {
		const body: unknown = await response.json();
		if (!body || typeof body !== "object" || !("message" in body) || typeof body.message !== "string") return null;

		const message = body.message.trim();
		return /^[\p{L}\p{N} .,:;'!?()/_-]{1,200}$/u.test(message) ? message : null;
	} catch {
		return null;
	}
};

export const enrollAgent = async (options: {
	controller: string;
	code: string;
	roots?: string[];
	configPath: string;
	allowInsecure?: boolean;
}): Promise<AgentConfiguration> => {
	const controller = new URL(options.controller);

	if (
		(controller.protocol !== "https:" && !(options.allowInsecure && controller.protocol === "http:")) ||
		controller.username ||
		controller.password
	) {
		throw new Error("Enrollment requires an HTTPS controller URL without embedded credentials");
	}

	const rootDefinitions = (options.roots ?? []).map((root, index) => {
		const rootPath = root.startsWith("~/") ? path.join(homedir(), root.slice(2)) : path.resolve(root);
		return { id: `files-${index + 1}`, label: `Files ${index + 1}`, path: rootPath, allowBackup: true };
	});
	const roots = JSON.stringify(rootDefinitions);

	createTrustedRootRegistry({ rawRoots: roots });

	const requestedPath = path.resolve(options.configPath);

	await mkdir(path.dirname(requestedPath), { recursive: true, mode: 0o700 });

	const directory = await realpath(path.dirname(requestedPath));
	const configPath = path.join(directory, path.basename(requestedPath));
	const release = await lock(configPath, { realpath: false });
	const staged = `${configPath}.${randomUUID()}.tmp`;

	try {
		const existing = await lstat(configPath).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return null;
			throw error;
		});

		if (existing)
			throw new Error(`Agent configuration already exists at ${configPath}; it will not be overwritten.`);

		const enrollmentUrl = new URL("/api/v1/agents/enroll", controller);
		const body = JSON.stringify({ code: options.code });

		const response = await fetch(enrollmentUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
		});

		if (!response.ok) {
			const detail = await readEnrollmentError(response);

			throw new Error(
				`Enrollment failed (${response.status})${detail ? `: ${detail}` : ""}. Generate a new connection code in Zerobyte.`,
			);
		}

		const credentials: unknown = await response.json();

		if (
			!credentials ||
			typeof credentials !== "object" ||
			!("token" in credentials) ||
			typeof credentials.token !== "string"
		) {
			throw new Error("Controller returned an invalid machine credential");
		}

		const connectionUrl = new URL("/api/v1/agents/connect", controller);
		connectionUrl.protocol = controller.protocol === "https:" ? "wss:" : "ws:";

		const configuration = {
			controllerUrl: connectionUrl.toString(),
			token: credentials.token,
			roots,
			...(controller.protocol === "http:" ? { allowInsecure: true } : {}),
		};

		const file = await open(staged, "wx", 0o600);

		try {
			await file.writeFile(JSON.stringify(configuration, null, 2));
			await file.sync();
		} finally {
			await file.close();
		}

		await link(staged, configPath);

		const parent = await open(directory, "r");
		try {
			await parent.sync();
		} finally {
			await parent.close();
		}

		return configuration;
	} finally {
		try {
			await rm(staged, { force: true });
		} finally {
			await release();
		}
	}
};

export const readAgentConfiguration = async (configPath: string): Promise<AgentConfiguration> => {
	const contents = await readFile(configPath, "utf8");
	let configuration: unknown;

	try {
		configuration = JSON.parse(contents);
	} catch {
		throw new Error("Invalid agent configuration. Enroll this machine from the Zerobyte controller.");
	}

	if (
		!configuration ||
		typeof configuration !== "object" ||
		!("token" in configuration) ||
		typeof configuration.token !== "string" ||
		!("controllerUrl" in configuration) ||
		typeof configuration.controllerUrl !== "string" ||
		!("roots" in configuration) ||
		typeof configuration.roots !== "string"
	) {
		throw new Error("Invalid agent configuration. Enroll this machine from the Zerobyte controller.");
	}

	return {
		...configuration,
		controllerUrl: configuration.controllerUrl,
		token: configuration.token,
		roots: configuration.roots,
		allowInsecure: "allowInsecure" in configuration && configuration.allowInsecure === true,
	};
};

export const configureAgent = async (configPath?: string) => {
	if (process.env.ZEROBYTE_BUILTIN_LOCAL_AGENT === "1") return;
	if (!configPath && process.env.ZEROBYTE_AGENT_TOKEN && process.env.ZEROBYTE_CONTROLLER_URL) return;

	configPath ??= defaultConfigPath();
	const configuration = await readAgentConfiguration(configPath);

	process.env.ZEROBYTE_AGENT_ALLOW_INSECURE =
		"allowInsecure" in configuration && configuration.allowInsecure === true ? "1" : "0";
	process.env.ZEROBYTE_AGENT_CONFIG_PATH = path.resolve(configPath);
	process.env.ZEROBYTE_CONTROLLER_URL = configuration.controllerUrl;
	process.env.ZEROBYTE_AGENT_TOKEN = configuration.token;
	process.env.ZEROBYTE_AGENT_ROOTS ??= configuration.roots;
};
