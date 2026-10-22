import { expect, test, vi } from "vitest";
import { createDockerCompose } from "../connection-docker";

vi.mock("~/client/lib/version", () => ({ APP_VERSION: "v1.2.3-beta.1" }));

test("Compose includes the matching agent release and enrollment settings with persistent state and a read-only source", () => {
	const yaml = createDockerCompose(
		"wss://controller.example/api/v1/agents/connect",
		"enrollment-code",
		"Archive node",
	);

	expect(Bun.YAML.parse(yaml)).toMatchObject({
		services: {
			agent: {
				image: "ghcr.io/nicotsx/zerobyte-agent:v1.2.3-beta.1",
				hostname: "archive-node",
				environment: {
					ZEROBYTE_CONTROLLER_URL: "https://controller.example",
					ZEROBYTE_AGENT_ENROLLMENT_CODE: "enrollment-code",
				},
				volumes: [
					"agent-config:/var/lib/zerobyte-agent",
					"agent-cache:/var/cache/zerobyte-agent",
					"/path/on/host:/data:ro",
				],
			},
		},
	});
	expect(yaml).not.toContain("ZEROBYTE_AGENT_TOKEN");
	expect(yaml).not.toContain("ZEROBYTE_AGENT_ALLOW_INSECURE_HTTP");
});

test("HTTP Compose opts into insecure HTTP explicitly", () => {
	const yaml = createDockerCompose("ws://192.168.1.10:8080/api/v1/agents/connect", "code", "Development");

	expect(Bun.YAML.parse(yaml)).toMatchObject({
		services: {
			agent: {
				environment: {
					ZEROBYTE_CONTROLLER_URL: "http://192.168.1.10:8080",
					ZEROBYTE_AGENT_ALLOW_INSECURE_HTTP: "true",
				},
			},
		},
	});
});

test.each(["12345", "true", "false", "null", "0x123", "1e3", "yes", "off"])(
	"Compose preserves scalar-looking hostname %s as a string",
	(machineName) => {
		const yaml = createDockerCompose("https://controller.example", "code", machineName);

		expect(Bun.YAML.parse(yaml)).toMatchObject({
			services: { agent: { hostname: machineName } },
		});
	},
);

test("Compose uses the default hostname when the machine name has no hostname characters", () => {
	const yaml = createDockerCompose("https://controller.example", "code", "!!!");

	expect(Bun.YAML.parse(yaml)).toMatchObject({
		services: { agent: { hostname: "zerobyte-agent" } },
	});
});

test("quoted settings stay literal and escape Compose interpolation", () => {
	const yaml = createDockerCompose("https://controller.example", 'code$VALUE"\nservices: injected', '"${HOST}"');

	expect(Bun.YAML.parse(yaml)).toMatchObject({
		services: {
			agent: {
				hostname: "host",
				environment: { ZEROBYTE_AGENT_ENROLLMENT_CODE: 'code$$VALUE"\nservices: injected' },
			},
		},
	});
});
