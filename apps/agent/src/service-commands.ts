import { spawn } from "node:child_process";
import { SERVICE_PATH } from "./system-service";

export const runServiceCommand = async (command: "systemctl" | "journalctl", args: string[]) => {
	if (process.platform !== "linux") throw new Error("Background agents require Linux with systemd.");
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { stdio: "inherit", env: { ...process.env, PATH: SERVICE_PATH } });
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0 || signal === "SIGINT") resolve();
			else reject(new Error(`${command} failed. Try running this command with sudo.`));
		});
	});
};

export const controlService = (action: "start" | "stop" | "restart" | "status") =>
	runServiceCommand("systemctl", [action, "zerobyte-agent.service", "--no-pager"]);

export const showLogs = (options: { lines: number; follow?: boolean }) =>
	runServiceCommand("journalctl", [
		"--unit=zerobyte-agent",
		"--no-pager",
		"--output=cat",
		`--lines=${options.lines}`,
		...(options.follow ? ["--follow"] : []),
	]);
