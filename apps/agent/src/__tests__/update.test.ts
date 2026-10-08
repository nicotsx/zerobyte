import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";
import { updateSystemService } from "../update";

const response = (body: ConstructorParameters<typeof Response>[0], url: string) => {
	const result = new Response(body, { status: 200 });
	Object.defineProperty(result, "url", { value: url });
	return result;
};

const requestUrl = (input: string | URL | Request) =>
	typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

test("update verifies the release and runs its native installer", async () => {
	const binary = new TextEncoder().encode("new native agent");
	const checksum = createHash("sha256").update(binary).digest("hex");
	const requestedUrls: string[] = [];
	const fetchRelease = vi.fn(async (input: string | URL | Request) => {
		const url = requestUrl(input);
		requestedUrls.push(url);
		return url.endsWith(".sha256")
			? response(`${checksum}  zerobyte-agent-linux-x64\n`, url)
			: response(binary, url);
	});
	const installedContents: string[] = [];

	await updateSystemService("v1.2.3", {
		platform: "linux",
		arch: "x64",
		uid: 0,
		fetch: fetchRelease,
		releaseBase: "https://releases.example/agent",
		runInstaller: async (path) => {
			installedContents.push(await readFile(path, "utf8"));
		},
	});

	expect(requestedUrls).toEqual([
		"https://releases.example/agent/v1.2.3/zerobyte-agent-linux-x64",
		"https://releases.example/agent/v1.2.3/zerobyte-agent-linux-x64.sha256",
	]);
	expect(installedContents).toEqual(["new native agent"]);
});

test("update does not run an executable whose checksum does not match", async () => {
	const runInstaller = vi.fn();
	const fetchRelease = vi.fn(async (input: string | URL | Request) => {
		const url = requestUrl(input);
		return url.endsWith(".sha256") ? response(`${"0".repeat(64)}\n`, url) : response("tampered", url);
	});

	await expect(
		updateSystemService("latest", {
			platform: "linux",
			arch: "arm64",
			uid: 0,
			fetch: fetchRelease,
			runInstaller,
		}),
	).rejects.toThrow("checksum mismatch");
	expect(runInstaller).not.toHaveBeenCalled();
});

test("update refuses a release redirect that leaves HTTPS", async () => {
	const runInstaller = vi.fn();
	const fetchRelease = vi.fn(
		async () => new Response(null, { status: 302, headers: { location: "http://downloads.example/agent" } }),
	);

	await expect(
		updateSystemService("latest", {
			platform: "linux",
			arch: "x64",
			uid: 0,
			fetch: fetchRelease,
			runInstaller,
		}),
	).rejects.toThrow("must remain on HTTPS");
	expect(runInstaller).not.toHaveBeenCalled();
});
