import { input, password } from "@inquirer/prompts";
import { $ } from "bun";
import { Command, InvalidArgumentError } from "commander";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDevControllerUrl } from "./dev-agent-controller";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

$.cwd(fileURLToPath(new URL("..", import.meta.url)));

const BUILD_TARGETS: Record<string, string> = {
	x86_64: "bun-linux-x64-baseline",
	aarch64: "bun-linux-arm64",
	arm64: "bun-linux-arm64",
};

const program = new Command()
	.name("bun run dev:agent")
	.description("Build and deploy the local agent to a Linux machine over SSH")
	.argument("[host]", "SSH host or user@host (also accepts ZEROBYTE_DEV_AGENT_HOST)")
	.option("-p, --port <port>", "SSH port", (value) => {
		const port = Number(value);
		if (!/^\d+$/.test(value) || port < 1 || port > 65535) throw new InvalidArgumentError("Invalid SSH port");
		return String(port);
	})
	.option("--code <code>", "Connection code for first-time enrollment")
	.action(async (hostArgument: string | undefined, options: { port?: string; code?: string }) => {
		const controller = await getDevControllerUrl((args) => $`portless ${args}`.quiet().text());
		console.info(`Using running controller: ${controller}`);

		const host =
			hostArgument ??
			process.env.ZEROBYTE_DEV_AGENT_HOST ??
			(await input({ message: "SSH host (user@server):" }));

		if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$/.test(host)) {
			throw new Error("Use an SSH hostname, IPv4 address, or configured SSH alias.");
		}

		const ssh = [...(options.port ? ["-p", options.port] : []), host];
		const sshHint = `ssh -t ${options.port ? `-p ${options.port} ` : ""}${host}`;

		console.info(`Checking ${host}…`);
		const probe =
			await $`ssh ${ssh} ${"uname -s && uname -m && test -f /etc/systemd/system/zerobyte-agent.service && echo installed || echo new"}`
				.quiet()
				.text();
		const [platform, architecture = "", installation] = probe.trim().split(/\r?\n/);

		if (platform !== "Linux") throw new Error("The agent installer supports Linux only.");

		const target = BUILD_TARGETS[architecture];
		if (!target) throw new Error(`Unsupported machine architecture: ${architecture}`);

		const enrollment = ["--controller", controller];

		if (installation === "new") {
			const code = options.code ?? (await password({ message: "Connection code from Zerobyte:" }));
			if (!code.trim()) throw new Error("A connection code is required.");

			enrollment.push("--code", code);
		} else {
			console.info(
				"Machine already installed; refreshing its controller address and keeping its identity and folders.",
			);
		}

		const localDirectory = await mkdtemp(join(tmpdir(), "zerobyte-dev-agent-"));
		const binary = join(localDirectory, "zerobyte-agent");
		const remoteBinary = `/tmp/zerobyte-dev-agent-${crypto.randomUUID()}`;

		try {
			console.info(`Building ${target}…`);
			await $`${process.execPath} run build:agent --target=${target} --outfile=${binary}`;

			console.info("Uploading agent…");
			await $`scp ${options.port ? ["-P", options.port] : []} ${binary} ${`${host}:${remoteBinary}`}`;

			console.info("Installing and restarting the background service…");
			const install = `chmod 700 ${quote(remoteBinary)} && sudo ${quote(remoteBinary)} install ${enrollment.map(quote).join(" ")}; status=$?; rm -f ${quote(remoteBinary)}; exit $status`;
			const exitCode = await Bun.spawn(["ssh", "-t", ...ssh, install], {
				stdio: ["inherit", "inherit", "inherit"],
			}).exited;

			if (exitCode !== 0) throw new Error(`Remote installation failed (${exitCode}).`);
		} finally {
			await rm(localDirectory, { recursive: true, force: true });
		}

		console.info(`Ready on ${host}. Logs: ${sshHint} 'sudo zerobyte-agent logs --follow'`);
		if (installation === "new") console.info(`Choose folders: ${sshHint} 'sudo zerobyte-agent folders add'`);
	});

try {
	await program.parseAsync();
} catch (error) {
	if (error instanceof Error && error.name === "ExitPromptError") process.exitCode = 130;
	else {
		console.error(error instanceof Error ? error.message : "Deployment failed");
		process.exitCode = 1;
	}
}
