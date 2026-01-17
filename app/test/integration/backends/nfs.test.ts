import { describe, expect, it, beforeAll } from "bun:test";
import { makeNfsBackend } from "../../../server/modules/backends/nfs/nfs-backend";
import { BACKEND_STATUS } from "../../../schemas/volumes";
import * as fs from "node:fs/promises";

describe("NFS Backend Integration", () => {
	const mountPath = "/tmp/test-mount-nfs";

	const config = {
		backend: "nfs" as const,
		server: "nfs-server",
		exportPath: "/",
		port: 2049,
		version: "4" as const,
	};

	beforeAll(async () => {
		await fs.rm(mountPath, { recursive: true, force: true }).catch(() => {});
	});

	it("should mount, check health, and unmount successfully", async () => {
		const backend = makeNfsBackend(config, mountPath);

		// 1. Mount
		const mountResult = await backend.mount();
		expect(mountResult.status).toBe(BACKEND_STATUS.mounted);

		// 2. Health Check
		const healthResult = await backend.checkHealth();
		expect(healthResult.status).toBe(BACKEND_STATUS.mounted);

		// 3. Write/Read test
		const testFile = `${mountPath}/test-nfs-${Date.now()}.txt`;
		await fs.writeFile(testFile, "hello from nfs integration");
		const content = await fs.readFile(testFile, "utf-8");
		expect(content).toBe("hello from nfs integration");

		// 4. Unmount
		const unmountResult = await backend.unmount();
		expect(unmountResult.status).toBe(BACKEND_STATUS.unmounted);
	}, 10000);
});
