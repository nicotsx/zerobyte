import fs from "node:fs";

function getRequiredEnv(name: string) {
	return process.env[name]!;
}

function getRequiredNumberEnv(name: string) {
	return Number.parseInt(getRequiredEnv(name), 10);
}

const host = getRequiredEnv("INTEGRATION_HOST");
const fixtureUid = getRequiredNumberEnv("FIXTURE_UID");
const fixtureGid = getRequiredNumberEnv("FIXTURE_GID");
const smbPassword = getRequiredEnv("SMB_PASSWORD");
const webdavPassword = getRequiredEnv("WEBDAV_PASSWORD");
const resticPassword = getRequiredEnv("RESTIC_PASSWORD");
const privateKey = fs.readFileSync(getRequiredEnv("SFTP_KEY_PATH"), "utf8");
const knownHosts = fs.readFileSync(getRequiredEnv("KNOWN_HOSTS_PATH"), "utf8");
const configPath = getRequiredEnv("CONFIG_PATH");

const fileText = "hello from zerobyte integration\n";
const readmeText = "fixture documentation\n";

const nfsEntries = [
	{ path: "hello.txt", type: "file", uid: fixtureUid, gid: fixtureGid, mode: "0644", text: fileText },
	{ path: "docs", type: "directory", uid: fixtureUid, gid: fixtureGid, mode: "0755" },
	{ path: "docs/readme.md", type: "file", uid: fixtureUid, gid: fixtureGid, mode: "0644", text: readmeText },
];

const smbEntries = [
	{ path: "hello.txt", type: "file", uid: fixtureUid, gid: fixtureGid, mode: "0644", text: fileText },
	{ path: "docs", type: "directory", uid: fixtureUid, gid: fixtureGid, mode: "0755" },
	{ path: "docs/readme.md", type: "file", uid: fixtureUid, gid: fixtureGid, mode: "0644", text: readmeText },
];

const contentOnlyEntries = [
	{ path: "hello.txt", type: "file", text: fileText },
	{ path: "docs", type: "directory" },
	{ path: "docs/readme.md", type: "file", text: readmeText },
];

const config = {
	version: 1,
	scenarios: [
		{
			id: "nfs-local-repo",
			volume: {
				backend: "nfs",
				server: host,
				exportPath: "/srv/zerobyte-backend-integration/fixtures",
				port: 2049,
				version: "4.1",
				readOnly: true,
			},
			repository: { backend: "local", path: "repo-nfs" },
			fixtureRoot: "case-a",
			expectedEntries: nfsEntries,
		},
		{
			id: "smb-local-repo",
			volume: {
				backend: "smb",
				server: host,
				share: "zerobyte-backend-integration",
				username: "zerobyte-smb",
				password: smbPassword,
				mapToContainerUidGid: false,
				vers: "3.0",
				port: 445,
				readOnly: true,
			},
			repository: { backend: "local", path: "repo-smb" },
			fixtureRoot: "case-a",
			expectedEntries: smbEntries,
		},
		{
			id: "sftp-local-repo",
			volume: {
				backend: "sftp",
				host,
				port: 22,
				username: "zerobyte-sftp",
				privateKey,
				path: "/srv/zerobyte-backend-integration/fixtures",
				readOnly: true,
				skipHostKeyCheck: false,
				knownHosts,
			},
			repository: { backend: "local", path: "repo-sftp-volume" },
			fixtureRoot: "case-a",
			expectedEntries: contentOnlyEntries,
		},
		{
			id: "webdav-local-repo",
			volume: {
				backend: "webdav",
				server: host,
				path: "/zerobyte-backend-integration",
				username: "zerobyte-webdav",
				password: webdavPassword,
				port: 80,
				readOnly: true,
				ssl: false,
			},
			repository: { backend: "local", path: "repo-webdav" },
			fixtureRoot: "case-a",
			expectedEntries: contentOnlyEntries,
		},
		{
			id: "nfs-sftp-repository",
			volume: {
				backend: "nfs",
				server: host,
				exportPath: "/srv/zerobyte-backend-integration/fixtures",
				port: 2049,
				version: "4.1",
				readOnly: true,
			},
			repository: {
				backend: "sftp",
				host,
				port: 22,
				user: "zerobyte-sftp",
				path: "/srv/zerobyte-backend-integration/restic-repo",
				privateKey,
				skipHostKeyCheck: false,
				knownHosts,
				isExistingRepository: true,
				customPassword: resticPassword,
			},
			fixtureRoot: "case-a",
			expectedEntries: nfsEntries,
		},
	],
};

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
