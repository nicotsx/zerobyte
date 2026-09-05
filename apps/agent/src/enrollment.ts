import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { createTrustedRootRegistry } from "./trusted-roots";

export type AgentConfiguration = { controllerUrl: string; token: string; roots: string };

const defaultConfigPath = () => path.join(homedir(), ".config", "zerobyte-agent", "agent.json");

export const enrollAgent = async (options: {
	controller: string;
	code: string;
	roots: string[];
	configPath: string;
}): Promise<AgentConfiguration> => {
	const controller = new URL(options.controller);
	if (controller.protocol !== "https:" || controller.username || controller.password) {
		throw new Error("Enrollment requires an HTTPS controller URL without embedded credentials");
	}
	if (options.roots.length === 0) throw new Error("Choose at least one folder with --root before enrolling");
	const rootDefinitions = options.roots.map((root, index) => {
		const rootPath = root.startsWith("~/") ? path.join(homedir(), root.slice(2)) : path.resolve(root);
		return { id: `files-${index + 1}`, label: `Files ${index + 1}`, path: rootPath, allowBackup: true };
	});
	const roots = JSON.stringify(rootDefinitions);
	createTrustedRootRegistry({ rawRoots: roots });
	const configPath = path.resolve(options.configPath);
	await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
	// Reserve the file before consuming the code. Never overwrite a machine identity.
	const file = await open(configPath, "wx", 0o600);
	try {
		const enrollmentUrl = new URL("/api/v1/agents/enroll", controller);
		const body = JSON.stringify({ code: options.code });
		const response = await fetch(enrollmentUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
		});
		if (!response.ok)
			throw new Error(`Enrollment failed (${response.status}). Generate a new connection code in Zerobyte.`);
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
		connectionUrl.protocol = "wss:";
		const configuration = { controllerUrl: connectionUrl.toString(), token: credentials.token, roots };
		await file.writeFile(JSON.stringify(configuration, null, 2));
		await file.sync();
		return configuration;
	} catch (error) {
		await unlink(configPath);
		throw error;
	} finally {
		await file.close();
	}
};

export const configureAgent = async () => {
	if (process.env.ZEROBYTE_BUILTIN_LOCAL_AGENT === "1") return;
	const { values, positionals } = parseArgs({
		args: process.argv.slice(2),
		allowPositionals: true,
		options: {
			controller: { type: "string" },
			code: { type: "string" },
			root: { type: "string", multiple: true },
			config: { type: "string" },
		},
	});
	const configPath = values.config ?? defaultConfigPath();
	let configuration: AgentConfiguration;
	if (positionals[0] === "enroll") {
		if (!values.controller || !values.code)
			throw new Error("Usage: enroll --controller https://zerobyte.example --code CODE --root /folder");
		const roots = values.root ?? [];
		configuration = await enrollAgent({ controller: values.controller, code: values.code, roots, configPath });
		console.info(`Machine enrolled. Configuration saved to ${configPath}. Starting the backup agent.`);
	} else {
		if (positionals.length > 0) throw new Error("Unknown agent command");
		if (process.env.ZEROBYTE_AGENT_TOKEN && process.env.ZEROBYTE_CONTROLLER_URL) return;
		const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
		if (
			!parsed ||
			typeof parsed !== "object" ||
			!("token" in parsed) ||
			typeof parsed.token !== "string" ||
			!("controllerUrl" in parsed) ||
			typeof parsed.controllerUrl !== "string" ||
			!("roots" in parsed) ||
			typeof parsed.roots !== "string"
		) {
			throw new Error("Invalid agent configuration. Enroll this machine from the Zerobyte controller.");
		}
		configuration = { token: parsed.token, controllerUrl: parsed.controllerUrl, roots: parsed.roots };
	}
	process.env.ZEROBYTE_AGENT_CONFIG_PATH = path.resolve(configPath);
	process.env.ZEROBYTE_CONTROLLER_URL = configuration.controllerUrl;
	process.env.ZEROBYTE_AGENT_TOKEN = configuration.token;
	process.env.ZEROBYTE_AGENT_ROOTS ??= configuration.roots;
};
