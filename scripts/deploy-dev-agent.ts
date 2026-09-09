import { Command, InvalidArgumentError } from "commander";
import { input, password } from "@inquirer/prompts";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const repository = fileURLToPath(new URL("..", import.meta.url));

const run = (command: string, args: string[], capture = false): Promise<string> =>
	new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: repository,
			stdio: ["inherit", capture ? "pipe" : "inherit", "inherit"],
		});

		let output = "";

		child.stdout?.on("data", (chunk) => {
			output += chunk.toString();
		});

		child.once("error", reject);
		child.once("exit", (code) => {
			if (code === 0) resolve(output.trim());
			else reject(new Error(`${command} failed (${code ?? "interrupted"}).`));
		});
	});

const program = new Command()
	.name("bun run dev:agent")
	.description("Build and deploy the local agent to a Linux machine over SSH")
	.argument("[host]", "SSH host or user@host (also accepts ZEROBYTE_DEV_AGENT_HOST)")
	.option("-p, --port <port>", "SSH port", (value) => {
		const port = Number(value);
		if (!/^\d+$/.test(value) || port < 1 || port > 65535) throw new InvalidArgumentError("Invalid SSH port");
		return String(port);
	})
	.option("--controller <url>", "Controller URL for first-time enrollment")
	.option("--code <code>", "Connection code for first-time enrollment")
	.option("--allow-insecure", "Allow HTTP for a development controller")
	.action(
		async (
			host: string | undefined,
			options: { port?: string; controller?: string; code?: string; allowInsecure?: boolean },
		) => {
			host ??= process.env.ZEROBYTE_DEV_AGENT_HOST;
			host ??= await input({ message: "SSH host (user@server):" });

			if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$/.test(host))
				throw new Error("Use an SSH hostname, IPv4 address, or configured SSH alias.");

			const sshArgs = [...(options.port ? ["-p", options.port] : []), host];

			console.info(`Checking ${host}…`);

			const probe = await run(
				"ssh",
				[
					...sshArgs,
					"uname -s && uname -m && if test -f /etc/systemd/system/zerobyte-agent.service; then echo installed; else echo new; fi",
				],
				true,
			);

			const [platform, architecture, installation] = probe.split(/\r?\n/);

			if (platform !== "Linux") throw new Error("The agent installer supports Linux only.");

			const target =
				architecture === "x86_64"
					? "bun-linux-x64-baseline"
					: architecture === "aarch64" || architecture === "arm64"
						? "bun-linux-arm64"
						: undefined;

			if (!target) throw new Error(`Unsupported machine architecture: ${architecture}`);

			if (installation !== "installed" && installation !== "new")
				throw new Error("Could not determine remote installation state.");

			const enrollment: string[] = [];

			if (installation === "new") {
				const controller =
					options.controller ?? (await input({ message: "Zerobyte URL reachable from this machine:" }));
				const url = new URL(controller);

				if (url.protocol !== "https:" && !(options.allowInsecure && url.protocol === "http:"))
					throw new Error("Use HTTPS, or pass --allow-insecure for HTTP development.");
				if (url.username || url.password) throw new Error("The controller URL must not contain credentials.");

				const code = options.code ?? (await password({ message: "Connection code from Zerobyte:" }));

				if (!code.trim()) throw new Error("A connection code is required.");

				enrollment.push("--controller", controller, "--code", code);
				if (options.allowInsecure) enrollment.push("--allow-insecure");
			} else if (options.controller || options.code || options.allowInsecure) {
				console.info("Machine already installed; keeping its existing identity and folders.");
			}

			const localDirectory = await mkdtemp(join(tmpdir(), "zerobyte-dev-agent-"));
			let remoteDirectory: string | undefined;

			try {
				const binary = join(localDirectory, "zerobyte-agent");

				console.info(`Building ${target}…`);
				await run(process.execPath, ["run", "build:agent", `--target=${target}`, `--outfile=${binary}`]);

				const destination = await run("ssh", [...sshArgs, "mktemp -d /tmp/zerobyte-dev.XXXXXXXX"], true);

				if (!/^\/tmp\/zerobyte-dev\.[a-zA-Z0-9]+$/.test(destination))
					throw new Error("Remote temporary directory was invalid.");

				remoteDirectory = destination;

				console.info("Uploading agent…");
				await run("scp", [
					...(options.port ? ["-P", options.port] : []),
					binary,
					`${host}:${destination}/zerobyte-agent`,
				]);

				const remoteBinary = `${destination}/zerobyte-agent`;

				console.info("Installing and restarting the background service…");
				await run("ssh", [
					"-t",
					...sshArgs,
					`chmod 700 ${quote(remoteBinary)} && sudo ${quote(remoteBinary)} install ${enrollment.map(quote).join(" ")}`,
				]);

				console.info(`Ready on ${host}. Installed at /usr/local/bin/zerobyte-agent.`);
				console.info(
					`Logs: ssh -t ${options.port ? `-p ${options.port} ` : ""}${host} 'sudo zerobyte-agent logs --follow'`,
				);

				if (installation === "new")
					console.info(
						`Choose folders: ssh -t ${options.port ? `-p ${options.port} ` : ""}${host} 'sudo zerobyte-agent folders add'`,
					);
			} finally {
				await rm(localDirectory, { recursive: true, force: true });

				if (remoteDirectory) {
					await run("ssh", [...sshArgs, `rm -rf -- ${quote(remoteDirectory)}`]).catch(() =>
						console.warn(`Could not remove temporary files on ${host}: ${remoteDirectory}`),
					);
				}
			}
		},
	);

try {
	await program.parseAsync();
} catch (error) {
	if (error instanceof Error && error.name === "ExitPromptError") process.exitCode = 130;
	else {
		console.error(error instanceof Error ? error.message : "Deployment failed");
		process.exitCode = 1;
	}
}
