import { expect, test } from "vitest";
import { isValidMachineName } from "../machine-name";

test.each(["\u2028", "\u2029"])("rejects Unicode separator %j in machine names", (separator) => {
	for (const name of [`NAS${separator}01`, `${separator}NAS01`, `NAS01${separator}`]) {
		expect(isValidMachineName(name)).toBe(false);
	}

	expect(isValidMachineName(separator)).toBe(false);
});

test("preserves ordinary Unicode machine names", () => {
	expect(isValidMachineName("  Équipe Zürich  ")).toBe(true);
});
