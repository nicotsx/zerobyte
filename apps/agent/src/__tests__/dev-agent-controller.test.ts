import { expect, test } from "vitest";
import { getDevControllerUrl } from "../../../../scripts/dev-agent-controller";

test("resolves the Tailscale URL of the running route for this worktree", async () => {
	const controller = await getDevControllerUrl(async (args) =>
		args[0] === "get"
			? "https://feature.zerobyte.localhost:1355\n"
			: `
Active routes:
  https://other.zerobyte.localhost:1355  ->  localhost:4000  (pid 100)
    tailscale: https://controller.example:8443
  https://feature.zerobyte.localhost:1355  ->  localhost:4110  (pid 101)
    tailscale: https://controller.example:9443
`,
	);

	expect(controller).toBe("https://controller.example:9443");
});

test.each(["", "not a URL", "https://user:secret@controller.example", "https://controller.example/path"])(
	"stops deployment when portless get returns an unusable URL: %j",
	async (url) => {
		await expect(getDevControllerUrl(async () => url)).rejects.toThrow(
			"Could not resolve the running Zerobyte controller",
		);
	},
);

test("stops deployment when portless get fails", async () => {
	await expect(
		getDevControllerUrl(async () => {
			throw new Error("portless failed");
		}),
	).rejects.toThrow("Start bun run dev");
});

test.each([
	"No active routes.",
	"  https://feature.zerobyte.localhost:1355  ->  localhost:4110  (pid 101)",
	`  https://feature.zerobyte.localhost:1355  ->  localhost:4110  (pid 101)
  https://other.zerobyte.localhost:1355  ->  localhost:4000  (pid 100)
    tailscale: https://controller.example:8443`,
	`  https://feature.zerobyte.localhost:1355  ->  localhost:4110  (alias)
    tailscale: https://controller.example:8443`,
])("requires an active Tailscale route for this worktree: %j", async (routes) => {
	await expect(
		getDevControllerUrl(async (args) => (args[0] === "get" ? "https://feature.zerobyte.localhost:1355" : routes)),
	).rejects.toThrow("Could not resolve the running Zerobyte controller");
});
