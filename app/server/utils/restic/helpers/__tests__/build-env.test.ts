import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { afterEach, describe, expect, test } from "bun:test";
import { db } from "~/server/db/db";
import { organization } from "~/server/db/schema";
import { RESTIC_CACHE_DIR } from "~/server/core/constants";
import { buildEnv } from "../build-env";

const withCustomPassword = <T extends object>(config: T) => ({
	...config,
	isExistingRepository: true as const,
	customPassword: "test-password",
});

const createTestOrg = async (overrides: Partial<typeof organization.$inferInsert> = {}) => {
	const id = randomUUID();
	await db.insert(organization).values({
		id,
		name: "Build-env test org",
		slug: `build-env-test-${id}`,
		createdAt: new Date(),
		metadata: { resticPassword: "org-restic-password" },
		...overrides,
	});
	return id;
};

const PLAIN_PRIVATE_KEY =
	"-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----";

const tempFiles = new Set<string>();

const trackTempFile = (filePath: string | undefined) => {
	if (filePath) {
		tempFiles.add(filePath);
	}
};

const buildEnvForTest = async (
	config: Parameters<typeof import("../build-env").buildEnv>[0],
	organizationId: string,
): Promise<ReturnType<typeof import("../build-env").buildEnv>> => {
	const env = await buildEnv(config, organizationId);

	// Automatically track all temp file paths created by buildEnv
	trackTempFile(env.RESTIC_PASSWORD_FILE);
	trackTempFile(env.GOOGLE_APPLICATION_CREDENTIALS);
	trackTempFile(env._SFTP_KEY_PATH);
	trackTempFile(env._SFTP_KNOWN_HOSTS_PATH);
	trackTempFile(env.RESTIC_CACERT);

	return env;
};

afterEach(async () => {
	await Promise.all(
		[...tempFiles].map(async (filePath) => {
			await fs.rm(filePath, { force: true });
		}),
	);
	tempFiles.clear();
});

describe("buildEnv", () => {
	describe("base environment", () => {
		test("always sets RESTIC_CACHE_DIR", async () => {
			const env = await buildEnvForTest(withCustomPassword({ backend: "local" as const, path: "/tmp/repo" }), "org-1");

			expect(env.RESTIC_CACHE_DIR).toBe(RESTIC_CACHE_DIR);
		});

		test("always sets PATH", async () => {
			const env = await buildEnvForTest(withCustomPassword({ backend: "local" as const, path: "/tmp/repo" }), "org-1");

			expect(env.PATH).toBeTruthy();
		});
	});

	describe("password resolution", () => {
		test("writes a password file when using customPassword on an existing repository", async () => {
			const env = await buildEnvForTest(
				{ backend: "local" as const, path: "/tmp/repo", isExistingRepository: true, customPassword: "my-secret" },
				"org-1",
			);

			const passwordFilePath = env.RESTIC_PASSWORD_FILE;
			expect(passwordFilePath).toBeDefined();
			if (!passwordFilePath) {
				throw new Error("Expected password file path to be defined");
			}

			const fileContent = await fs.readFile(passwordFilePath, "utf-8");
			expect(fileContent).toBe("my-secret");
		});

		test("writes a password file from the organization's resticPassword when no customPassword is given", async () => {
			const orgId = await createTestOrg();

			const env = await buildEnvForTest({ backend: "local" as const, path: "/tmp/repo" }, orgId);

			const passwordFilePath = env.RESTIC_PASSWORD_FILE;
			expect(passwordFilePath).toBeDefined();
			if (!passwordFilePath) {
				throw new Error("Expected password file path to be defined");
			}

			const fileContent = await fs.readFile(passwordFilePath, "utf-8");
			expect(fileContent).toBe("org-restic-password");
		});

		test("throws when the organization does not exist", async () => {
			await expect(buildEnv({ backend: "local" as const, path: "/tmp/repo" }, "non-existent-org")).rejects.toThrow(
				"Organization non-existent-org not found",
			);
		});

		test("throws when the organization has no resticPassword configured", async () => {
			const orgId = await createTestOrg({ metadata: null });

			await expect(buildEnv({ backend: "local" as const, path: "/tmp/repo" }, orgId)).rejects.toThrow(
				`Restic password not configured for organization ${orgId}`,
			);
		});
	});

	describe("s3 backend", () => {
		const base = withCustomPassword({
			backend: "s3" as const,
			endpoint: "https://s3.amazonaws.com",
			bucket: "my-bucket",
			accessKeyId: "my-access-key",
			secretAccessKey: "my-secret-key",
		});

		test("sets AWS credentials", async () => {
			const env = await buildEnvForTest(base, "org-1");

			expect(env.AWS_ACCESS_KEY_ID).toBe("my-access-key");
			expect(env.AWS_SECRET_ACCESS_KEY).toBe("my-secret-key");
		});

		test("sets AWS_S3_BUCKET_LOOKUP=dns for Huawei Cloud endpoints", async () => {
			const env = await buildEnvForTest({ ...base, endpoint: "https://obs.ap-southeast-1.myhuaweicloud.com" }, "org-1");

			expect(env.AWS_S3_BUCKET_LOOKUP).toBe("dns");
		});

		test("does not set AWS_S3_BUCKET_LOOKUP for standard S3 endpoints", async () => {
			const env = await buildEnvForTest(base, "org-1");

			expect(env.AWS_S3_BUCKET_LOOKUP).toBeUndefined();
		});
	});

	describe("r2 backend", () => {
		test("sets AWS credentials with auto region and forced path style", async () => {
			const env = await buildEnvForTest(
				withCustomPassword({
					backend: "r2" as const,
					endpoint: "https://myaccount.r2.cloudflarestorage.com",
					bucket: "my-bucket",
					accessKeyId: "r2-access-key",
					secretAccessKey: "r2-secret-key",
				}),
				"org-1",
			);

			expect(env.AWS_ACCESS_KEY_ID).toBe("r2-access-key");
			expect(env.AWS_SECRET_ACCESS_KEY).toBe("r2-secret-key");
			expect(env.AWS_REGION).toBe("auto");
			expect(env.AWS_S3_FORCE_PATH_STYLE).toBe("true");
		});
	});

	describe("gcs backend", () => {
		test("sets project ID and writes credentials file", async () => {
			const env = await buildEnvForTest(
				withCustomPassword({
					backend: "gcs" as const,
					bucket: "my-gcs-bucket",
					projectId: "my-gcp-project",
					credentialsJson: '{"type":"service_account"}',
				}),
				"org-1",
			);

			expect(env.GOOGLE_PROJECT_ID).toBe("my-gcp-project");

			const credentialsPath = env.GOOGLE_APPLICATION_CREDENTIALS;
			expect(credentialsPath).toBeDefined();
			if (!credentialsPath) {
				throw new Error("Expected credentials path to be defined");
			}

			const fileContent = await fs.readFile(credentialsPath, "utf-8");
			expect(fileContent).toBe('{"type":"service_account"}');
		});
	});

	describe("azure backend", () => {
		const base = withCustomPassword({
			backend: "azure" as const,
			container: "my-container",
			accountName: "mystorageaccount",
			accountKey: "my-account-key",
		});

		test("sets account name and key", async () => {
			const env = await buildEnvForTest(base, "org-1");

			expect(env.AZURE_ACCOUNT_NAME).toBe("mystorageaccount");
			expect(env.AZURE_ACCOUNT_KEY).toBe("my-account-key");
		});

		test("includes endpoint suffix when provided", async () => {
			const env = await buildEnvForTest({ ...base, endpointSuffix: "core.chinacloudapi.cn" }, "org-1");

			expect(env.AZURE_ENDPOINT_SUFFIX).toBe("core.chinacloudapi.cn");
		});

		test("omits endpoint suffix when not provided", async () => {
			const env = await buildEnvForTest(base, "org-1");

			expect(env.AZURE_ENDPOINT_SUFFIX).toBeUndefined();
		});
	});

	describe("rest backend", () => {
		test("sets username and password when both are provided", async () => {
			const env = await buildEnvForTest(
				withCustomPassword({
					backend: "rest" as const,
					url: "https://rest-server.example.com",
					username: "rest-user",
					password: "rest-pass",
				}),
				"org-1",
			);

			expect(env.RESTIC_REST_USERNAME).toBe("rest-user");
			expect(env.RESTIC_REST_PASSWORD).toBe("rest-pass");
		});

		test("omits REST credentials when neither username nor password is provided", async () => {
			const env = await buildEnvForTest(
				withCustomPassword({ backend: "rest" as const, url: "https://rest-server.example.com" }),
				"org-1",
			);

			expect(env.RESTIC_REST_USERNAME).toBeUndefined();
			expect(env.RESTIC_REST_PASSWORD).toBeUndefined();
		});
	});

	describe("sftp backend", () => {
		const baseSftpConfig = withCustomPassword({
			backend: "sftp" as const,
			host: "backup.example.com",
			port: 22,
			user: "backup",
			path: "/backups",
			privateKey: PLAIN_PRIVATE_KEY,
			skipHostKeyCheck: true as const,
		});

		test("throws for passphrase-protected private keys", async () => {
			await expect(
				buildEnv(
					{
						...baseSftpConfig,
						privateKey: "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\n-----END RSA PRIVATE KEY-----",
					},
					"org-1",
				),
			).rejects.toThrow("Passphrase-protected SSH keys are not supported");
		});

		test("succeeds when the private key has CRLF line endings", async () => {
			const crlfKey = PLAIN_PRIVATE_KEY.replace(/\n/g, "\r\n");

			await expect(buildEnv({ ...baseSftpConfig, privateKey: crlfKey }, "org-1")).resolves.toBeDefined();
		});

		test("uses StrictHostKeyChecking=no when skipHostKeyCheck is true", async () => {
			const env = await buildEnvForTest({ ...baseSftpConfig, skipHostKeyCheck: true }, "org-1");

			expect(env._SFTP_SSH_ARGS).toContain("StrictHostKeyChecking=no");
			expect(env._SFTP_SSH_ARGS).toContain("UserKnownHostsFile=/dev/null");
		});

		test("uses StrictHostKeyChecking=no when knownHosts is absent", async () => {
			const env = await buildEnvForTest({ ...baseSftpConfig, skipHostKeyCheck: false, knownHosts: undefined }, "org-1");

			expect(env._SFTP_SSH_ARGS).toContain("StrictHostKeyChecking=no");
			expect(env._SFTP_SSH_ARGS).toContain("UserKnownHostsFile=/dev/null");
		});

		test("uses StrictHostKeyChecking=yes and a known hosts file when knownHosts is provided", async () => {
			const env = await buildEnvForTest(
				{
					...baseSftpConfig,
					skipHostKeyCheck: false,
					knownHosts: "backup.example.com ssh-rsa AAAAB3NzaC1...",
				},
				"org-1",
			);

			expect(env._SFTP_SSH_ARGS).toContain("StrictHostKeyChecking=yes");
			expect(env._SFTP_SSH_ARGS).toContain("UserKnownHostsFile=/tmp/zerobyte-known-hosts-");
			expect(env._SFTP_KNOWN_HOSTS_PATH).toMatch(/^\/tmp\/zerobyte-known-hosts-/);
		});

		test("adds -p flag for non-default ports", async () => {
			const env = await buildEnvForTest({ ...baseSftpConfig, port: 2222 }, "org-1");

			expect(env._SFTP_SSH_ARGS).toContain("-p 2222");
		});

		test("omits -p flag for the default port 22", async () => {
			const env = await buildEnvForTest({ ...baseSftpConfig, port: 22 }, "org-1");

			expect(env._SFTP_SSH_ARGS).not.toContain("-p 22");
		});

		test("sets the key path in both _SFTP_KEY_PATH and SSH args -i flag", async () => {
			const env = await buildEnvForTest(baseSftpConfig, "org-1");

			expect(env._SFTP_KEY_PATH).toMatch(/^\/tmp\/zerobyte-ssh-/);
			expect(env._SFTP_SSH_ARGS).toContain(`-i ${env._SFTP_KEY_PATH}`);
		});
	});

	describe("cacert", () => {
		test("sets RESTIC_CACERT pointing to a temp file when cacert is provided", async () => {
			const env = await buildEnvForTest(
				withCustomPassword({
					backend: "local" as const,
					path: "/tmp/repo",
					cacert: "-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----",
				}),
				"org-1",
			);

			const certPath = env.RESTIC_CACERT;
			expect(certPath).toBeDefined();
			if (!certPath) {
				throw new Error("Expected certificate path to be defined");
			}

			const fileContent = await fs.readFile(certPath, "utf-8");
			expect(fileContent).toBe("-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----");
		});

		test("does not set RESTIC_CACERT when cacert is absent", async () => {
			const env = await buildEnvForTest(withCustomPassword({ backend: "local" as const, path: "/tmp/repo" }), "org-1");

			expect(env.RESTIC_CACERT).toBeUndefined();
		});
	});

	describe("insecure TLS", () => {
		test("sets _INSECURE_TLS=true when insecureTls is true", async () => {
			const env = await buildEnvForTest(
				withCustomPassword({ backend: "local" as const, path: "/tmp/repo", insecureTls: true }),
				"org-1",
			);

			expect(env._INSECURE_TLS).toBe("true");
		});

		test("does not set _INSECURE_TLS when insecureTls is absent", async () => {
			const env = await buildEnvForTest(withCustomPassword({ backend: "local" as const, path: "/tmp/repo" }), "org-1");

			expect(env._INSECURE_TLS).toBeUndefined();
		});
	});
});
