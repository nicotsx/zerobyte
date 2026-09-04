const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const { Arch } = require("electron-builder");

const desktopDir = __dirname;
const repoRoot = path.resolve(desktopDir, "..", "..");
const runtimeResourceDir = path.resolve(desktopDir, "..", "..", "tmp", "desktop", "zerobyte-runtime");
const executableName = "zerobyte";
const requiresMacSigning = process.env.ZEROBYTE_REQUIRE_MAC_SIGNING === "true";
const shouldNotarize = Boolean(
	process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER,
);
const shouldSignMac = process.env.ZEROBYTE_MAC_SIGN === "true" || shouldNotarize || requiresMacSigning;
const macIdentity = shouldSignMac ? undefined : null;

const readCurrentGitTag = () => {
	try {
		return execFileSync("git", ["describe", "--tags", "--exact-match"], {
			cwd: repoRoot,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return undefined;
	}
};

let releaseVersion = process.env.ZEROBYTE_DESKTOP_VERSION;
if (!releaseVersion) releaseVersion = process.env.APP_VERSION;
if (!releaseVersion) releaseVersion = process.env.GITHUB_REF_NAME;
if (!releaseVersion) releaseVersion = readCurrentGitTag();

const releaseTag = releaseVersion?.replace(/^refs\/tags\//, "");
const packageVersion = releaseTag?.replace(/^v/, "").match(/^\d+\.\d+\.\d+/)?.[0];
const buildNumber = process.env.ZEROBYTE_BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER;

if (releaseTag && !process.env.APP_VERSION) {
	process.env.APP_VERSION = releaseTag;
}
if (releaseTag && !process.env.VITE_APP_VERSION) {
	process.env.VITE_APP_VERSION = releaseTag;
}

if (!releaseTag || !packageVersion) {
	throw new Error("Desktop builds require a release version like v0.39.0 or v0.39.0-beta.3.");
}

const archNames = {
	[Arch.x64]: "x64",
	[Arch.arm64]: "arm64",
};

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

const prepareRuntime = async ({ electronPlatformName, arch }) => {
	const archName = archNames[arch];
	if (!archName) {
		throw new Error(`Unsupported desktop target architecture: ${arch}`);
	}

	await run("bun", ["run", "build:electron"]);
	await run("bun", ["scripts/prepare-runtime.ts", "--platform", electronPlatformName, "--arch", archName]);
};

const signAdHoc = async ({ appOutDir, electronPlatformName }) => {
	if (shouldSignMac || electronPlatformName !== "darwin") return;

	const appPath = path.join(appOutDir, `${executableName}.app`);
	await run("codesign", ["--deep", "--force", "--sign", "-", appPath]);
	await run("codesign", ["--verify", "--deep", "--strict", appPath]);
};

/** @type {import("electron-builder").Configuration} */
const config = {
	appId: "com.nicotsx.zerobyte",
	productName: "Zerobyte",
	executableName,
	extraMetadata: { version: packageVersion },
	asar: true,
	forceCodeSigning: requiresMacSigning,
	artifactName: `zerobyte-${releaseTag}-\${os}-\${arch}.\${ext}`,
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
		],
		hardenedRuntime: true,
		entitlements: "electron/entitlements.mac.plist",
		entitlementsInherit: "electron/entitlements.mac.plist",
		bundleVersion: buildNumber,
		identity: macIdentity,
		notarize: shouldNotarize,
	},
	win: {
		icon: "assets/icon.ico",
		target: [
			{
				target: "nsis",
				arch: ["x64"],
			},
		],
	},
	linux: {
		category: "Utility",
		target: [
			{
				target: "AppImage",
				arch: ["x64"],
			},
		],
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
	afterPack: signAdHoc,
};

module.exports = config;
