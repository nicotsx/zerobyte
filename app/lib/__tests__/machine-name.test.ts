import { expect, test } from "vitest";
import { getMachineDisplayName, isValidMachineName } from "../machine-name";

test.each(["\u2028", "\u2029"])("rejects and removes Unicode separator %j in machine names", (separator) => {
	for (const name of [`NAS${separator}01`, `${separator}NAS01`, `NAS01${separator}`]) {
		expect(isValidMachineName(name)).toBe(false);
		expect(getMachineDisplayName(name)).toBe("NAS01");
	}

	expect(isValidMachineName(separator)).toBe(false);
	expect(getMachineDisplayName(separator)).toBe("Unnamed machine");
});

test("preserves ordinary Unicode machine names", () => {
	expect(isValidMachineName("  Équipe Zürich  ")).toBe(true);
	expect(getMachineDisplayName("  Équipe Zürich  ")).toBe("Équipe Zürich");
});
