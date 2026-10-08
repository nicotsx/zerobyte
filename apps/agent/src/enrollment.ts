import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { configuredRootsSchema, createTrustedRootRegistry, parseConfiguredRoots } from "./trusted-roots";

const agentConfigurationSchema = z.object({
	controllerUrl: z.string(),
	token: z.string(),
	roots: configuredRootsSchema,
});

const enrollmentResponseSchema = z.object({ token: z.string() });

export type AgentConfiguration = z.infer<typeof agentConfigurationSchema> & { configPath?: string };

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

	const roots = options.roots.map((root, index) => {
		const rootPath = root.startsWith("~/") ? path.join(homedir(), root.slice(2)) : path.resolve(root);

		return { id: `files-${index + 1}`, label: `Files ${index + 1}`, path: rootPath, allowBackup: true };
	});

	createTrustedRootRegistry({ roots });

	const configPath = path.resolve(options.configPath);

	if (existsSync(configPath))
		throw new Error(`This machine is already enrolled. Delete ${configPath} to enroll it again.`);

	await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });

	const response = await fetch(new URL("/api/v1/agents/enroll", controller), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ code: options.code }),
		redirect: "error",
		signal: AbortSignal.timeout(15_000),
	});

	if (!response.ok) {
		throw new Error(`Enrollment failed (${response.status}). Generate a new connection code in Zerobyte.`);
	}

	const credentials = enrollmentResponseSchema.safeParse(await response.json());

	if (!credentials.success) {
		throw new Error("Zerobyte returned an invalid machine credential. Generate a new connection code in Zerobyte.");
	}

	const connectionUrl = new URL("/api/v1/agents/connect", controller);
	connectionUrl.protocol = "wss:";

	const configuration = { controllerUrl: connectionUrl.toString(), token: credentials.data.token, roots };

	await writeFile(configPath, JSON.stringify(configuration, null, 2), { flag: "wx", mode: 0o600 });

	return configuration;
};

const readSavedConfiguration = async (configPath: string) => {
	let parsed: unknown;

	try {
		parsed = JSON.parse(await readFile(configPath, "utf8"));
	} catch (error) {
		if (error instanceof SyntaxError || (error instanceof Error && "code" in error && error.code === "ENOENT")) {
			throw new Error("Invalid agent configuration. Enroll this machine from the Zerobyte controller.");
		}

		throw error;
	}

	const result = agentConfigurationSchema.safeParse(parsed);

	if (!result.success) {
		throw new Error("Invalid agent configuration. Enroll this machine from the Zerobyte controller.");
	}

	return result.data;
};

export const configureAgent = async (): Promise<AgentConfiguration> => {
	const rawEnvironmentRoots = process.env.ZEROBYTE_AGENT_ROOTS;
	const environmentRoots = rawEnvironmentRoots === undefined ? undefined : parseConfiguredRoots(rawEnvironmentRoots);

	const environmentConfiguration = {
		controllerUrl: process.env.ZEROBYTE_CONTROLLER_URL ?? "",
		token: process.env.ZEROBYTE_AGENT_TOKEN ?? "",
		roots: environmentRoots ?? [],
		configPath: process.env.ZEROBYTE_AGENT_CONFIG_PATH,
	};

	if (process.env.ZEROBYTE_BUILTIN_LOCAL_AGENT === "1") return environmentConfiguration;

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
		if (environmentConfiguration.token && environmentConfiguration.controllerUrl) return environmentConfiguration;

		configuration = await readSavedConfiguration(configPath);
	}

	return {
		...configuration,
		roots: environmentRoots ?? configuration.roots,
		configPath: path.resolve(configPath),
	};
};
