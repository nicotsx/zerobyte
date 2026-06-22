const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const { Arch } = require("electron-builder");

const desktopDir = __dirname;
const repoRoot = path.resolve(desktopDir, "..", "..");
const runtimeResourceDir = path.resolve(desktopDir, "..", "..", "tmp", "desktop", "zerobyte-runtime");
const shouldNotarize = Boolean(
	process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER,
);
const isMasTarget = process.argv.some((arg) => arg === "mas" || arg === "mas-dev" || arg.includes("--mac=mas"));
const shouldSign = process.env.ZEROBYTE_MAC_SIGN === "true" || shouldNotarize || isMasTarget;

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
const appStoreVersion = releaseTag?.replace(/^v/, "").match(/^\d+\.\d+\.\d+/)?.[0];
const buildNumber = process.env.ZEROBYTE_BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER;
const exportComplianceCode =
	process.env.ZEROBYTE_EXPORT_COMPLIANCE_CODE || process.env.APP_STORE_EXPORT_COMPLIANCE_CODE;
const masProvisioningProfile =
	process.env.ZEROBYTE_MAS_PROVISIONING_PROFILE || path.join(desktopDir, "profiles", "mac-app-store.provisionprofile");
const masDevProvisioningProfile =
	process.env.ZEROBYTE_MAS_DEV_PROVISIONING_PROFILE ||
	path.join(desktopDir, "profiles", "mac-development.provisionprofile");

if (releaseTag && !process.env.APP_VERSION) {
	process.env.APP_VERSION = releaseTag;
}
if (releaseTag && !process.env.VITE_APP_VERSION) {
	process.env.VITE_APP_VERSION = releaseTag;
}

if (!releaseTag || !appStoreVersion) {
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
	const runtimePlatformName = electronPlatformName === "mas" ? "darwin" : electronPlatformName;
	if (!archName) {
		throw new Error(`Unsupported desktop target architecture: ${arch}`);
	}

	await run("bun", ["run", "build:electron"]);
	await run("bun", ["scripts/prepare-runtime.ts", "--platform", runtimePlatformName, "--arch", archName]);
};

/** @type {import("electron-builder").Configuration} */
const config = {
	appId: "com.nicotsx.zerobyte",
	productName: "Zerobyte",
	extraMetadata: { version: appStoreVersion },
	asar: true,
	artifactName: `\${productName}-${releaseTag}-\${os}-\${arch}.\${ext}`,
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
		extendInfo: {
			ITSAppUsesNonExemptEncryption: Boolean(exportComplianceCode),
			...(exportComplianceCode ? { ITSEncryptionExportComplianceCode: exportComplianceCode } : {}),
		},
		target: [
			{
				target: "dmg",
				arch: ["arm64"],
			},
		],
		hardenedRuntime: true,
		entitlements: "electron/entitlements.mac.plist",
		entitlementsInherit: "electron/entitlements.mac.plist",
		...(buildNumber ? { bundleVersion: buildNumber } : {}),
		...(shouldSign ? {} : { identity: null }),
		...(shouldNotarize ? { notarize: true } : {}),
	},
	mas: {
		hardenedRuntime: false,
		entitlements: "electron/entitlements.mas.plist",
		entitlementsInherit: "electron/entitlements.mas.inherit.plist",
		provisioningProfile: masProvisioningProfile,
	},
	masDev: {
		provisioningProfile: masDevProvisioningProfile,
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
