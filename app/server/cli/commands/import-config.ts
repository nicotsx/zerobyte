import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";
import { toError } from "../../utils/errors";

type Output = ReturnType<typeof createOutput>;

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf-8");
}

function createOutput(jsonOutput: boolean) {
	return {
		error: (message: string): never => {
			if (jsonOutput) {
				console.log(JSON.stringify({ error: message }));
			} else {
				console.error(`❌ ${message}`);
			}
			process.exit(1);
		},
		info: (message: string): void => {
			if (!jsonOutput) {
				console.log(message);
			}
		},
		json: (data: object): void => {
			if (jsonOutput) {
				console.log(JSON.stringify(data));
			}
		},
	};
}

async function readConfigJson(options: { stdin?: boolean; config?: string }, out: Output): Promise<string> {
	if (options.stdin) {
		out.info("📄 Reading config from stdin...");
		try {
			const configJson = await readStdin();
			if (!configJson.trim()) {
				out.error("No input received from stdin");
			}
			return configJson;
		} catch (e) {
			out.error(`Failed to read stdin: ${toError(e).message}`);
		}
	}

	const configPath = path.resolve(process.cwd(), options.config ?? "");
	try {
		await fs.access(configPath);
	} catch {
		out.error(`Config file not found: ${configPath}`);
	}

	out.info(`📄 Config file: ${configPath}`);
	return fs.readFile(configPath, "utf-8");
}

export const importConfigCommand = new Command("import-config")
	.description("Import configuration from a JSON file or stdin")
	.option("-c, --config <path>", "Path to the configuration file")
	.option("--stdin", "Read configuration from stdin")
	.option("--dry-run", "Validate the config without importing")
	.option("--json", "Output results in JSON format")
	.option("--log-level <level>", "Set log level (debug, info, warn, error)")
	.option("--overwrite-recovery-key", "Overwrite existing recovery key (only allowed if database is empty)")
	.action(async (options) => {
		const jsonOutput = options.json;
		const out = createOutput(jsonOutput);

		// Set log level: explicit option takes precedence
		if (options.logLevel) {
			process.env.LOG_LEVEL = options.logLevel;
		}

		out.info("\n📦 Zerobyte Config Import\n");

		if (!options.config && !options.stdin) {
			if (!jsonOutput) {
				console.log("\nUsage:");
				console.log("  zerobyte import-config --config /path/to/config.json");
				console.log("  cat config.json | zerobyte import-config --stdin");
			}
			out.error("Either --config <path> or --stdin is required");
		}

		if (options.config && options.stdin) {
			out.error("Cannot use both --config and --stdin");
		}

		const configJson = await readConfigJson(options, out);

		// Parse and validate JSON
		let config: unknown;
		try {
			config = JSON.parse(configJson);
		} catch (e) {
			out.error(`Invalid JSON: ${toError(e).message}`);
		}

		if (options.dryRun) {
			const root = typeof config === "object" && config !== null ? config : {};
			const configObj =
				"config" in root && typeof root.config === "object" && root.config !== null ? root.config : root;

			const sections = ["volumes", "repositories", "backupSchedules", "notificationDestinations", "users"];
			const counts: Record<string, number> = {};
			for (const section of sections) {
				const items = (configObj as Record<string, unknown>)[section] || [];
				counts[section] = Array.isArray(items) ? items.length : 0;
			}
			const hasRecoveryKey = !!(configObj as Record<string, unknown>).recoveryKey;

			if (jsonOutput) {
				out.json({ dryRun: true, valid: true, counts, hasRecoveryKey });
			} else {
				console.log("🔍 Dry run mode - validating config only\n");
				for (const section of sections) {
					console.log(`   ${section}: ${counts[section]} item(s)`);
				}
				console.log(`   recoveryKey: ${hasRecoveryKey ? "provided" : "not provided"}`);
				console.log("\n✅ Config is valid JSON");
			}
			return;
		}

		try {
			// Ensure database is initialized with migrations
			const { runDbMigrations } = await import("../../db/db");
			runDbMigrations();

			const { applyConfigImport } = await import("../../modules/lifecycle/config-import");
			const result = await applyConfigImport(config, { overwriteRecoveryKey: options.overwriteRecoveryKey });

			out.json({ ...result, success: result.errors === 0 });

			// Exit with error code if there were errors
			if (result.errors > 0) {
				process.exit(1);
			}
		} catch (e) {
			out.error(`Import failed: ${toError(e).message}`);
		}
	});
