import { expect, test, vi } from "vitest";
import { createConnectionCommand } from "../connection-command";

vi.mock("~/client/lib/version", () => ({ APP_VERSION: "v1.2.3-beta.1" }));

test("the dashboard installs the controller's release without asking for folders", () => {
	const command = createConnectionCommand("wss://controller.example/api/v1/agents/connect", "enrollment-code");
	expect(command).toContain(
		"https://zerobyte.app/install.sh | sudo env ZEROBYTE_AGENT_VERSION='v1.2.3-beta.1' bash -s --",
	);
	expect(command).toContain("--controller 'https://controller.example' --code 'enrollment-code'");
	expect(command).not.toContain("--root");
});

test("an HTTP development controller gets an explicit insecure enrollment flag", () => {
	const command = createConnectionCommand("ws://192.168.1.10:8080/api/v1/agents/connect", "code");
	expect(command).toContain("--controller 'http://192.168.1.10:8080'");
	expect(command).toContain("--allow-insecure");
	expect(command).toContain("--proto '=https'");
	expect(createConnectionCommand("wss://controller.example/api/v1/agents/connect", "code")).not.toContain(
		"--allow-insecure",
	);
});
