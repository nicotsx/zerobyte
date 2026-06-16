import { Command } from "commander";
import { toMessage } from "~/server/utils/errors";
import { systemService } from "~/server/modules/system/system.service";

export const enablePasswordLoginCommand = new Command("enable-password-login")
	.description("Re-enable password login for break-glass recovery")
	.action(async () => {
		console.info("\nZerobyte Password Login Recovery\n");

		try {
			await systemService.setPasswordLoginDisabled(false);
			console.info("\nPassword login has been re-enabled.");
		} catch (error) {
			console.error(`\nFailed to re-enable password login: ${toMessage(error)}`);
			process.exit(1);
		}

		process.exit(0);
	});
