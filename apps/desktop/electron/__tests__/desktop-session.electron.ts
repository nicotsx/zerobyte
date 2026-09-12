import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { app, session } from "electron";
import { createDesktopTls } from "../desktop-tls";
import { createDesktopSession } from "../desktop-session";

const userData = mkdtempSync(path.join(os.tmpdir(), "zerobyte-session-"));
app.setPath("userData", userData);

void app.whenReady().then(async () => {
	const server = https.createServer(await createDesktopTls(), (request, response) => {
		if (request.url === "/api/v1/desktop/session") {
			assert.equal(request.headers["x-zerobyte-desktop-launch-secret"], "test-secret");
			response.setHeader(
				"Set-Cookie",
				"__Secure-session=initial; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=3600",
			);
		} else if (request.url === "/rotate") {
			assert.equal(request.headers.cookie, "__Secure-session=initial");
			response.setHeader(
				"Set-Cookie",
				"__Secure-session=rotated; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=3600",
			);
		} else {
			assert.equal(request.headers.cookie, "__Secure-session=rotated");
		}

		response.end("{}");
	});

	try {
		server.listen(0, "127.0.0.1");

		await once(server, "listening");
		const address = server.address();

		assert(address && typeof address === "object");

		const url = `https://127.0.0.1:${address.port}`;

		assert.equal(await createDesktopSession(url, "test-secret"), undefined);

		const [cookie] = await session.defaultSession.cookies.get({ url });

		assert(cookie);
		assert.equal(cookie.httpOnly, true);
		assert.equal(cookie.secure, true);
		assert.equal(cookie.sameSite, "strict");
		assert(cookie.expirationDate && cookie.expirationDate > Date.now() / 1000 + 3500);

		for (const route of ["/rotate", "/authenticated"]) {
			const response = await session.defaultSession.fetch(url + route, {
				credentials: "include",
				redirect: "error",
			});
			assert.equal(response.status, 200);
			await response.text();
		}

		console.info("PASS: Electron bootstrap retains cookie attributes and forwards updated cookies");
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	} finally {
		await session.defaultSession.closeAllConnections();

		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));

		rmSync(userData, { recursive: true, force: true });
		app.exit(Number(process.exitCode ?? 0));
	}
});
