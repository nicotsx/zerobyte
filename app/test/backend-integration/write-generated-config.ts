import fs from "node:fs";

function getRequiredEnv(name: string) {
	return process.env[name]!;
}

const host = getRequiredEnv("INTEGRATION_HOST");
const sftpPassword = getRequiredEnv("SFTP_PASSWORD");
const knownHosts = fs.readFileSync(getRequiredEnv("KNOWN_HOSTS_PATH"), "utf8");
const configPath = getRequiredEnv("CONFIG_PATH");

const fileText = "hello from zerobyte integration\n";
const readmeText = "fixture documentation\n";

const contentOnlyEntries = [
	{ path: "hello.txt", type: "file", text: fileText },
	{ path: "docs", type: "directory" },
	{ path: "docs/readme.md", type: "file", text: readmeText },
];

const config = {
	version: 1,
	scenarios: [
		{
			id: "sftp-legacy-rsa-hostkey-local-repo",
			volume: {
				backend: "sftp",
				host,
				port: 2222,
				username: "zerobyte-sftp",
				password: sftpPassword,
				path: "/srv/zerobyte-backend-integration/fixtures",
				readOnly: true,
				skipHostKeyCheck: false,
				knownHosts,
				allowLegacySshRsa: true,
			},
			repository: { backend: "local", path: "repo-sftp-legacy-rsa-hostkey-volume" },
			fixtureRoot: "case-a",
			expectedEntries: contentOnlyEntries,
		},
	],
};

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
