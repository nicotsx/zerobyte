import { expect, test } from "vitest";
import { createTrustedSourcePresentation } from "./trusted-source-presentation";

const trustedRootCases = [
	["an ordinary trusted root", "/srv/data"],
	["the filesystem root", "/"],
] as const;

test.each(trustedRootCases)("prefixes browse paths for %s", (_name, rootPath) => {
	const presentation = createTrustedSourcePresentation({
		configuredRootPath: rootPath,
		canonicalRootPath: rootPath,
		sourceRelativePath: "photos",
	});
	const rootResult = presentation.formatBrowseResult({
		path: "/",
		directories: [{ name: "albums", path: "/albums" }],
	});
	const nestedResult = presentation.formatBrowseResult({
		path: "/albums",
		directories: [{ name: "summer", path: "/albums/summer" }],
	});

	expect(rootResult).toEqual({
		path: "trusted-root:",
		directories: [{ name: "albums", path: "trusted-root:albums" }],
	});
	expect(nestedResult).toEqual({
		path: "trusted-root:albums",
		directories: [{ name: "summer", path: "trusted-root:albums/summer" }],
	});
});
