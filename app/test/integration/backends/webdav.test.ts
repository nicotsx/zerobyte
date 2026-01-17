import { describe, expect, it, beforeAll } from "bun:test";
import { makeWebdavBackend } from "../../../server/modules/backends/webdav/webdav-backend";
import { BACKEND_STATUS } from "../../../schemas/volumes";
import * as fs from "node:fs/promises";

describe("WebDAV Backend Integration", () => {
	const mountPath = "/tmp/test-mount-webdav";

	const config = {
		backend: "webdav" as const,
		server: "webdav-server",
		path: "/",
		username: "testuser",
		password: "testpass",
		port: 80,
		ssl: false,
	};

	beforeAll(async () => {
		await fs.rm(mountPath, { recursive: true, force: true }).catch(() => {});

		await fs.mkdir("/etc/davfs2", { recursive: true }).catch(() => {});

		const davConfig = "trust_server_cert 1\nuse_locks 0\n";
		await fs.writeFile("/etc/davfs2/davfs2.conf", davConfig);
	});

	it("should mount, check health, and unmount successfully", async () => {
		const backend = makeWebdavBackend(config, mountPath);

		// 1. Mount
		const mountResult = await backend.mount();
		expect(mountResult.status).toBe(BACKEND_STATUS.mounted);

		// 2. Health Check
		const healthResult = await backend.checkHealth();
		expect(healthResult.status).toBe(BACKEND_STATUS.mounted);

		// 3. Write/Read test
		const testFile = `${mountPath}/test-webdav-${Date.now()}.txt`;
		await fs.writeFile(testFile, "hello from webdav integration");
		const content = await fs.readFile(testFile, "utf-8");
		expect(content).toBe("hello from webdav integration");

		// 4. Unmount
		const unmountResult = await backend.unmount();
		expect(unmountResult.status).toBe(BACKEND_STATUS.unmounted);
	}, 10000);
});
