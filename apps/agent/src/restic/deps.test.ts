import { afterEach, expect, test, vi } from "vitest";
import { resticDeps } from "./deps";

afterEach(() => {
	vi.unstubAllEnvs();
});

test("uses the configured unquoted RESTIC_COMMAND", () => {
	vi.stubEnv("RESTIC_COMMAND", ' "/opt/restic" ');
	const dependencies = resticDeps("password");

	expect(dependencies.resticCommand).toBe("/opt/restic");
});

test("defaults RESTIC_COMMAND to restic", () => {
	vi.stubEnv("RESTIC_COMMAND", undefined);
	const dependencies = resticDeps("password");

	expect(dependencies.resticCommand).toBe("restic");
});
