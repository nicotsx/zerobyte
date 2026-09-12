import { afterEach, expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { RotatingLog } from "../rotating-log";
let desktopLog: typeof import("../desktop-log");

const { getPath } = vi.hoisted(() => ({ getPath: vi.fn() }));
vi.mock("electron", () => ({ app: { getPath } }));

const directories: string[] = [];
const setup = async () => {
	vi.resetModules();
	desktopLog = await import("../desktop-log");
	const directory = mkdtempSync(path.join(os.tmpdir(), "zerobyte-desktop-log-"));
	directories.push(directory);
	getPath.mockReturnValue(directory);
	return path.join(desktopLog.getDesktopLogsPath(), "desktop.log");
};

afterEach(async () => {
	await desktopLog?.closeDesktopLog();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("persists timestamped output and error details without ANSI codes or launch credentials", async () => {
	const file = await setup();
	const { writeDesktopLog, redactDesktopLogSecrets } = desktopLog;
	vi.stubEnv("NODE_ENV", "production");
	redactDesktopLogSecrets(
		"test-launch-secret",
		"-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----",
	);
	writeDesktopLog("server:stdout", "\u001b[32mready\u001b[0m test-launch-secret password=example");
	writeDesktopLog("server:stderr", "private-key-material");
	writeDesktopLog("desktop", new Error("Directory not found: C:\\Users\\test\\Documents"));

	await desktopLog.closeDesktopLog();
	const content = readFileSync(file, "utf8");
	expect(content).toMatch(/\d{4}-\d{2}-\d{2}T.*Z \[server:stdout\] ready \[REDACTED\] password=\*\*\*/);
	expect(content).toContain("[server:stderr] [REDACTED]");
	expect(content).toContain("Error: Directory not found: C:\\Users\\test\\Documents");
	expect(content).not.toContain("\u001b");
	expect(content).not.toContain("test-launch-secret");
	expect(content).not.toContain("private-key-material");
	if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
});

test("appends existing logs, rotates in order, and retains one backup", async () => {
	const file = await setup();
	const { mkdirSync } = await import("node:fs");
	mkdirSync(path.dirname(file));
	writeFileSync(file, "previous launch\n");
	const sink = new RotatingLog(file, 40);
	sink.write("next launch\n");
	await sink.close();
	expect(readFileSync(file, "utf8")).toBe("previous launch\nnext launch\n");
	const rotating = new RotatingLog(file, 40);
	rotating.write("a".repeat(30) + "\n");
	rotating.write("b".repeat(30) + "\n");
	rotating.write("c".repeat(30) + "\n");
	await rotating.close();
	expect(readFileSync(file, "utf8")).toBe("c".repeat(30) + "\n");
	expect(readFileSync(file + ".1", "utf8")).toBe("b".repeat(30) + "\n");
	expect(readdirSync(path.dirname(file)).sort()).toEqual(["desktop.log", "desktop.log.1"]);
});

test("drops excess output while flushing accepted records in order", async () => {
	const file = await setup();
	const sink = new RotatingLog(file, 1024, 20);
	sink.write("first\n");
	sink.write("second\n");
	sink.write("x".repeat(20));
	sink.write("third\n");
	await sink.close();
	const content = readFileSync(file, "utf8");
	expect(content).toBe("first\nsecond\nthird\n");
	expect(content).not.toContain("x".repeat(20));
	sink.write("after close");
	expect(readFileSync(file, "utf8")).toBe(content);
});

test("returns before disk initialization completes", async () => {
	const file = await setup();
	const sink = new RotatingLog(file);
	sink.write("queued\n");
	// No filesystem work has completed in the synchronous stream callback.
	expect(() => statSync(file)).toThrow();
	await sink.close();
	expect(readFileSync(file, "utf8")).toBe("queued\n");
});

test("a disk failure does not crash the app or reject shutdown", async () => {
	await setup();
	const blocker = path.join(getPath(), "blocked");
	writeFileSync(blocker, "not a directory");
	const sink = new RotatingLog(path.join(blocker, "desktop.log"));
	const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
	sink.write("still running");
	await expect(sink.close()).resolves.toBeUndefined();
	expect(stderr).toHaveBeenCalledWith("[zerobyte] Unable to write desktop log\n");
});

test("omits oversized records", async () => {
	const file = await setup();
	desktopLog.writeDesktopLog("server:stdout", "x".repeat(100_000));
	await desktopLog.closeDesktopLog();
	expect(statSync(file).size).toBeLessThan(66_000);
	expect(readFileSync(file, "utf8")).toContain("[oversized log record omitted]");
});
