import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { toMessage } from "@zerobyte/core/utils";
import { Data, Effect } from "effect";
import { z } from "zod";
import * as fs from "./fs";
import { configuredRootsSchema, parseConfiguredRoots } from "./trusted-roots";

const agentConfigurationSchema = z.looseObject({
	controllerUrl: z.string(),
	token: z.string(),
	roots: configuredRootsSchema,
});

export type AgentConfiguration = z.infer<typeof agentConfigurationSchema>;

export class ConfigurationMissing extends Data.TaggedError("ConfigurationMissing")<{ message: string }> {}
export class ConfigurationUnreadable extends Data.TaggedError("ConfigurationUnreadable")<{ message: string }> {}

const describeIssues = (configPath: string, error: z.ZodError) => {
	const issues = error.issues.map((issue) => `${issue.path.join(".") || "configuration"}: ${issue.message}`);

	return `Invalid agent configuration at ${configPath}: ${issues.join("; ")}. Fix the listed fields before retrying; preserve the saved identity and folder settings.`;
};

const readFailure = (configPath: string, error: unknown) => {
	const code = error instanceof Error && "code" in error ? error.code : undefined;

	if (code === "ENOENT") {
		return new ConfigurationMissing({
			message: `No agent configuration at ${configPath}. Get a connection command from Settings → Machines and run it on this machine to enroll the agent.`,
		});
	}

	if (code === "EACCES" || code === "EPERM") {
		return new ConfigurationUnreadable({
			message: `Cannot read agent configuration at ${configPath}: permission denied. Run the agent command with sudo or correct the file's permissions.`,
		});
	}

	return new ConfigurationUnreadable({
		message: `Cannot read agent configuration at ${configPath}: ${toMessage(error)}`,
	});
};

export const readConfiguration = (configPath: string) =>
	Effect.gen(function* () {
		const contents = yield* Effect.tryPromise({
			try: () => readFile(configPath, "utf8"),
			catch: (error) => readFailure(configPath, error),
		});

		const parsed = yield* Effect.try({
			try: () => JSON.parse(contents) as unknown,
			catch: () =>
				new ConfigurationUnreadable({
					message: `Invalid agent configuration at ${configPath}: the file is not valid JSON. Correct its JSON syntax before retrying; preserve the saved identity and folder settings.`,
				}),
		});

		const result = agentConfigurationSchema.safeParse(parsed);
		if (!result.success)
			return yield* new ConfigurationUnreadable({ message: describeIssues(configPath, result.error) });

		return result.data;
	});

export const writeConfiguration = (configPath: string, configuration: AgentConfiguration) =>
	Effect.gen(function* () {
		const result = agentConfigurationSchema.safeParse(configuration);
		if (!result.success)
			return yield* new ConfigurationUnreadable({ message: describeIssues(configPath, result.error) });

		const staged = yield* fs.stagingPath(configPath);

		yield* fs.makeDirectory(path.dirname(configPath), 0o700);
		yield* fs.writePrivateFile(staged, JSON.stringify(result.data, null, 2));
		yield* fs.move(staged, configPath);
	}).pipe(Effect.scoped);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const environmentRoots = Effect.try({
	try: () => {
		const raw = process.env.ZEROBYTE_AGENT_ROOTS;
		return raw === undefined ? undefined : parseConfiguredRoots(raw);
	},
	catch: (error) => new ConfigurationUnreadable({ message: toMessage(error) }),
});

const environmentControllerUrl = (value: string) =>
	Effect.try({
		try: () => new URL(value),
		catch: () => new ConfigurationUnreadable({ message: `ZEROBYTE_CONTROLLER_URL is not a valid URL: ${value}` }),
	}).pipe(
		Effect.filterOrFail(
			(url) => url.protocol === "wss:" || (url.protocol === "ws:" && LOOPBACK_HOSTS.has(url.hostname)),
			() =>
				new ConfigurationUnreadable({
					message: "ZEROBYTE_CONTROLLER_URL must use wss://, or ws:// on a loopback address",
				}),
		),
	);

export type LoadedConfiguration = AgentConfiguration & { configPath?: string };

/** Environment credentials take precedence so supervised and containerized agents need no file. */
export const loadConfiguration = (configPath: string) =>
	Effect.gen(function* () {
		const roots = yield* environmentRoots;
		const controllerUrl = process.env.ZEROBYTE_CONTROLLER_URL;
		const token = process.env.ZEROBYTE_AGENT_TOKEN;

		if (controllerUrl && token) {
			yield* environmentControllerUrl(controllerUrl);
			return { controllerUrl, token, roots: roots ?? [] } satisfies LoadedConfiguration;
		}

		const saved = yield* readConfiguration(configPath);

		return {
			...saved,
			roots: roots ?? saved.roots,
			configPath: path.resolve(configPath),
		} satisfies LoadedConfiguration;
	});
