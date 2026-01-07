import { Command } from "commander";
import { importConfigCommand } from "./commands/import-config";
import { resetPasswordCommand } from "./commands/reset-password";

const program = new Command();

program.name("zerobyte").description("Zerobyte CLI - Backup automation tool built on top of Restic").version("1.0.0");
program.addCommand(importConfigCommand);
program.addCommand(resetPasswordCommand);

export async function runCLI(argv: string[]): Promise<boolean> {
	const args = argv.slice(2);
	const isCLIMode = process.env.ZEROBYTE_CLI === "1";

	if (args.length === 0) {
		if (isCLIMode) {
			program.help();
			return true;
		}
		return false;
	}

	if (!isCLIMode && args[0].startsWith("-")) {
		return false;
	}

	await program.parseAsync(argv).catch((err) => {
		if (err.message.includes("SIGINT")) {
			process.exit(0);
		}

		console.error(err.message);
		process.exit(1);
	});

	return true;
}

export { program };
