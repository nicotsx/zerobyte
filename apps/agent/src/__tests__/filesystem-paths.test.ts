import path from "node:path";
import { expect, test, vi } from "vitest";
import { relativeFilesystemPath, reportSourceError } from "../filesystem-paths";

test.each([path.parse(process.cwd()).root, path.join(path.parse(process.cwd()).root, "srv", "data")])(
	"returns plain relative paths under %s",
	(rootPath) => {
		expect(relativeFilesystemPath(rootPath, rootPath)).toBe("");
		expect(relativeFilesystemPath(rootPath, path.join(rootPath, "photos", "summer"))).toBe("photos/summer");
		expect(relativeFilesystemPath(rootPath, path.join(rootPath, "trusted-root:photos"))).toBe(
			"trusted-root:photos",
		);
	},
);

test("hides paths outside the source", () => {
	const rootPath = path.join(path.parse(process.cwd()).root, "srv", "data");

	for (const filePath of [path.join(rootPath, "..", "secret.txt"), `${rootPath}-other${path.sep}secret.txt`]) {
		expect(relativeFilesystemPath(rootPath, filePath)).toBe("[outside source]");
	}
});

test.each(["EPERM", "EACCES"])("preserves %s for folder access guidance without revealing host paths", (code) => {
	const hostPath = "/private/files/secret";
	const details = `Failed to list files: ${code}: permission denied, scandir '${hostPath}'`;
	const log = vi.spyOn(console, "error").mockImplementation(() => {});

	try {
		expect(reportSourceError(new Error(details))).toBe(`${code}: Access to this folder was denied.`);
		expect(log).toHaveBeenCalledWith(details);
	} finally {
		log.mockRestore();
	}
});
