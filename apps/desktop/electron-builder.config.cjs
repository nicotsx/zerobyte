const path = require("node:path");
const { spawn } = require("node:child_process");

const desktopDir = __dirname;
const runtimeResourceDir = path.resolve(desktopDir, "..", "..", "tmp", "desktop", "zerobyte-runtime");
const shouldNotarize = Boolean(
	process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER,
);
const shouldSign = process.env.ZEROBYTE_MAC_SIGN === "true" || shouldNotarize;

const run = (command, args) =>
	new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: desktopDir,
			env: { ...process.env, VITE_GIT_HOOKS: "0" },
			stdio: "inherit",
		});

		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
		});
	});

const prepareRuntime = async ({ electronPlatformName }) => {
	await run("bun", ["run", "build:electron"]);
	await run("bun", ["scripts/prepare-runtime.ts", "--platform", electronPlatformName, "--arch", "arm64"]);
};

/** @type {import("electron-builder").Configuration} */
const config = {
	appId: "com.nicotsx.zerobyte",
	productName: "Zerobyte",
	asar: true,
	artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
	directories: {
		output: "dist",
		buildResources: "assets",
	},
	files: ["package.json", ".vite/build/**/*"],
	extraResources: [
		{
			from: runtimeResourceDir,
			to: "zerobyte-runtime",
		},
		{
			from: "assets/tray-icon.png",
			to: "tray-icon.png",
		},
	],
	mac: {
		category: "public.app-category.utilities",
		icon: "assets/icon.icns",
		target: [
			{
				target: "dmg",
				arch: ["arm64"],
			},
			{
				target: "zip",
				arch: ["arm64"],
			},
		],
		hardenedRuntime: true,
		entitlements: "electron/entitlements.mac.plist",
		entitlementsInherit: "electron/entitlements.mac.plist",
		...(shouldSign ? {} : { identity: null }),
		...(shouldNotarize ? { notarize: true } : {}),
	},
	dmg: {
		background: "assets/dmg-background.png",
		icon: "assets/icon.icns",
		iconSize: 96,
		contents: [
			{ x: 176, y: 136, type: "file" },
			{ x: 482, y: 136, type: "link", path: "/Applications" },
		],
		window: {
			width: 658,
			height: 346,
		},
	},
	beforePack: prepareRuntime,
};

module.exports = config;
