import { Command } from "commander";
import { resetPasswordCommand } from "./commands/reset-password";

const program = new Command();

program.name("zerobyte").description("Zerobyte CLI - Backup automation tool built on top of Restic").version("1.0.0");
program.addCommand(resetPasswordCommand);

export async function runCLI(argv: string[]): Promise<boolean> {
	const args = argv.slice(2);
	const hasCommand = args.length > 0 && !args[0].startsWith("-");

	if (!hasCommand) {
		return false;
	}

	await program.parseAsync(argv);
	return true;
}

export { program };
