import { afterEach, expect, test, vi } from "vitest";
import { resolveResticHostname } from "../hostname";

const fsMock = vi.hoisted(() => ({ readFileSync: vi.fn() }));
const osMock = vi.hoisted(() => ({ hostname: vi.fn() }));

vi.mock("node:fs", () => fsMock);
vi.mock("node:os", () => ({ default: osMock }));

afterEach(() => {
	delete process.env.RESTIC_HOSTNAME;
	fsMock.readFileSync.mockReset();
	osMock.hostname.mockReset();
});

test("uses the configured RESTIC_HOSTNAME when present", () => {
	process.env.RESTIC_HOSTNAME = "configured-host";

	expect(resolveResticHostname()).toBe("configured-host");
	expect(fsMock.readFileSync).not.toHaveBeenCalled();
});

test("normalizes Docker container IDs to the stable Zerobyte hostname", () => {
	const containerId = "abc123".padEnd(64, "0");
	fsMock.readFileSync.mockReturnValue(`123 456 0:1 / ${containerId} /etc/hostname rw - ext4 /dev/root rw`);
	osMock.hostname.mockReturnValue("abc123");

	expect(resolveResticHostname()).toBe("zerobyte");
});

test("keeps non-container hostnames from mountinfo", () => {
	const containerId = "def456".padEnd(64, "0");
	fsMock.readFileSync.mockReturnValue(`123 456 0:1 / ${containerId} /etc/hostname rw - ext4 /dev/root rw`);
	osMock.hostname.mockReturnValue("backup-host");

	expect(resolveResticHostname()).toBe("backup-host");
});

test("uses the stable Zerobyte hostname when mountinfo is unavailable", () => {
	fsMock.readFileSync.mockImplementation(() => {
		throw new Error("unavailable");
	});

	expect(resolveResticHostname()).toBe("zerobyte");
});

test("uses the stable Zerobyte hostname when hostname mount is missing", () => {
	fsMock.readFileSync.mockReturnValue("123 456 0:1 / / rw - overlay overlay rw");

	expect(resolveResticHostname()).toBe("zerobyte");
});
