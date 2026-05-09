import { afterEach, expect, test, vi } from "vitest";

const fsMock = vi.hoisted(() => ({
	readFileSync: vi.fn(),
}));

const osMock = vi.hoisted(() => ({
	hostname: vi.fn(),
}));

vi.mock("node:fs", () => fsMock);
vi.mock("node:os", () => ({ default: osMock }));

afterEach(() => {
	delete process.env.RESTIC_HOSTNAME;
	fsMock.readFileSync.mockReset();
	osMock.hostname.mockReset();
});

test("uses the configured RESTIC_HOSTNAME when present", async () => {
	process.env.RESTIC_HOSTNAME = "configured-host";
	const { resolveResticHostname } = await import("../hostname");

	expect(resolveResticHostname()).toBe("configured-host");
	expect(fsMock.readFileSync).not.toHaveBeenCalled();
});

test("normalizes Docker container IDs to the stable Zerobyte hostname", async () => {
	const containerId = "abc123".padEnd(64, "0");
	fsMock.readFileSync.mockReturnValue(`123 456 0:1 / ${containerId} /etc/hostname rw - ext4 /dev/root rw`);
	osMock.hostname.mockReturnValue("abc123");
	const { resolveResticHostname } = await import("../hostname");

	expect(resolveResticHostname()).toBe("zerobyte");
});

test("keeps non-container hostnames from mountinfo", async () => {
	const containerId = "def456".padEnd(64, "0");
	fsMock.readFileSync.mockReturnValue(`123 456 0:1 / ${containerId} /etc/hostname rw - ext4 /dev/root rw`);
	osMock.hostname.mockReturnValue("backup-host");
	const { resolveResticHostname } = await import("../hostname");

	expect(resolveResticHostname()).toBe("backup-host");
});

test("uses the stable Zerobyte hostname when mountinfo is unavailable", async () => {
	fsMock.readFileSync.mockImplementation(() => {
		throw new Error("unavailable");
	});
	osMock.hostname.mockReturnValue("ephemeral-container-host");
	const { resolveResticHostname } = await import("../hostname");

	expect(resolveResticHostname()).toBe("zerobyte");
});

test("uses the stable Zerobyte hostname when hostname mount is missing", async () => {
	fsMock.readFileSync.mockReturnValue("123 456 0:1 / / rw - overlay overlay rw");
	osMock.hostname.mockReturnValue("ephemeral-container-host");
	const { resolveResticHostname } = await import("../hostname");

	expect(resolveResticHostname()).toBe("zerobyte");
});
