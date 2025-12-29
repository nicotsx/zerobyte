import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf-8");
}

export const importConfigCommand = new Command("import-config")
	.description("Import configuration from a JSON file or stdin")
	.option("-c, --config <path>", "Path to the configuration file")
	.option("--stdin", "Read configuration from stdin")
	.option("--dry-run", "Validate the config without importing")
	.action(async (options) => {
		console.log("\n📦 Zerobyte Config Import\n");

		if (!options.config && !options.stdin) {
			console.error("❌ Either --config <path> or --stdin is required");
			console.log("\nUsage:");
			console.log("  zerobyte import-config --config /path/to/config.json");
			console.log("  cat config.json | zerobyte import-config --stdin");
			process.exit(1);
		}

		if (options.config && options.stdin) {
			console.error("❌ Cannot use both --config and --stdin");
			process.exit(1);
		}

		let configJson: string;

		if (options.stdin) {
			console.log("📄 Reading config from stdin...");
			try {
				configJson = await readStdin();
				if (!configJson.trim()) {
					console.error("❌ No input received from stdin");
					process.exit(1);
				}
			} catch (e) {
				const err = e instanceof Error ? e : new Error(String(e));
				console.error(`❌ Failed to read stdin: ${err.message}`);
				process.exit(1);
			}
		} else {
			const configPath = path.resolve(process.cwd(), options.config);

			// Check if file exists
			try {
				await fs.access(configPath);
			} catch {
				console.error(`❌ Config file not found: ${configPath}`);
				process.exit(1);
			}

			console.log(`📄 Config file: ${configPath}`);
			configJson = await fs.readFile(configPath, "utf-8");
		}

		// Parse and validate JSON
		let config: unknown;
		try {
			config = JSON.parse(configJson);
		} catch (e) {
			const err = e instanceof Error ? e : new Error(String(e));
			console.error(`❌ Invalid JSON: ${err.message}`);
			process.exit(1);
		}

		if (options.dryRun) {
			console.log("🔍 Dry run mode - validating config only\n");

			const root = typeof config === "object" && config !== null ? config : {};
			const configObj =
				"config" in root && typeof root.config === "object" && root.config !== null ? root.config : root;

			const sections = ["volumes", "repositories", "backupSchedules", "notificationDestinations", "users"];
			for (const section of sections) {
				const items = (configObj as Record<string, unknown>)[section] || [];
				const count = Array.isArray(items) ? items.length : 0;
				console.log(`   ${section}: ${count} item(s)`);
			}

			const hasRecoveryKey = !!(configObj as Record<string, unknown>).recoveryKey;
			console.log(`   recoveryKey: ${hasRecoveryKey ? "provided" : "not provided"}`);

			console.log("\n✅ Config is valid JSON");
			return;
		}

		console.log("🚀 Starting import...\n");

		try {
			// Ensure database is initialized with migrations
			const { runDbMigrations } = await import("../../db/db");
			runDbMigrations();

			const { applyConfigImport } = await import("../../modules/lifecycle/config-import");
			await applyConfigImport(config);

			console.log("\n✅ Import completed successfully");
		} catch (e) {
			const err = e instanceof Error ? e : new Error(String(e));
			console.error(`\n❌ Import failed: ${err.message}`);
			process.exit(1);
		}
	});
