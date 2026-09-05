import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { asShortId } from "~/server/utils/branded";

const tempRoots = new Set<string>();

afterEach(async () => {
	vi.doUnmock("../constants");
	vi.doUnmock("~/server/core/constants");
	vi.doUnmock("../fs");
	vi.doUnmock("@zerobyte/core/node");
	vi.resetModules();

	for (const root of tempRoots) {
		await fs.rm(root, { recursive: true, force: true });
	}

	tempRoots.clear();
});

const loadCleanup = async (
	readMountInfo: () => Promise<{ mountPoint: string; fstype: string }[]> = async () => [],
	unmount: (mountPath: string) => Promise<void> = async () => {
		throw new Error("Unexpected unmount");
	},
	tempBase = os.tmpdir(),
) => {
	vi.resetModules();
	const tempRoot = await fs.mkdtemp(path.join(tempBase, "zerobyte-controller-cleanup-"));
	tempRoots.add(tempRoot);
	const volumeRoot = path.join(tempRoot, "volumes");
	await fs.mkdir(volumeRoot);

	const unmountedPaths: string[] = [];
	vi.doMock("@zerobyte/core/node", async () => ({
		...(await vi.importActual<typeof import("@zerobyte/core/node")>("@zerobyte/core/node")),
		safeExec: async ({ command, args }: { command: string; args: string[] }) => {
			expect(command).toBe("umount");
			expect(args[0]).toBe("-l");
			const mountPath = args[1]!;
			unmountedPaths.push(mountPath);
			await unmount(mountPath);
			return { exitCode: 0, stdout: "", stderr: "" };
		},
	}));

	vi.doMock("../constants", () => ({ VOLUME_MOUNT_BASE: volumeRoot }));
	vi.doMock("~/server/core/constants", async () => ({
		...(await vi.importActual<typeof import("~/server/core/constants")>("~/server/core/constants")),
		VOLUME_MOUNT_BASE: volumeRoot,
	}));
	vi.doMock("../fs", async () => ({
		...(await vi.importActual<typeof import("../fs")>("../fs")),
		readMountInfo,
	}));

	const { runDbMigrations } = await import("~/server/db/db");
	await runDbMigrations();
	const { createTestVolume } = await import("~/test/helpers/volume");
	const { cleanupDanglingVolumeMountDirectories } = await import("../cleanup");

	return { tempRoot, volumeRoot, createTestVolume, cleanupDanglingVolumeMountDirectories, unmountedPaths };
};

test.each(["_data", ""])("removes stale empty managed directories containing %s", async (child) => {
	const { volumeRoot, cleanupDanglingVolumeMountDirectories } = await loadCleanup();
	const volumeDir = path.join(volumeRoot, "stale-volume");
	await fs.mkdir(path.join(volumeDir, child), { recursive: true });

	await cleanupDanglingVolumeMountDirectories();

	await expect(fs.access(volumeDir)).rejects.toThrow();
});

test.each(["_data", "_data/nested", ""])("keeps directories with a mounted path at %s", async (child) => {
	const mounts: { mountPoint: string; fstype: string }[] = [];
	const { volumeRoot, cleanupDanglingVolumeMountDirectories } = await loadCleanup(async () => mounts);
	const volumeDir = path.join(volumeRoot, "mounted-volume");
	mounts.push({ mountPoint: path.join(volumeDir, child), fstype: "fuse.sshfs" });
	await fs.mkdir(path.join(volumeDir, "_data"), { recursive: true });

	await cleanupDanglingVolumeMountDirectories();

	await expect(fs.access(path.join(volumeDir, "_data"))).resolves.toBeNull();
});

test.each(["error", "unmounted", "mounted"] as const)(
	"preserves saved local volumes with status %s",
	async (status) => {
		const mounts: { mountPoint: string; fstype: string }[] = [];
		const { volumeRoot, createTestVolume, cleanupDanglingVolumeMountDirectories, unmountedPaths } =
			await loadCleanup(async () => mounts);
		const { createTestOrganization } = await import("~/test/helpers/organization");
		const otherOrganization = await createTestOrganization({ id: "other-org", slug: "other-org" });

		for (const organizationId of ["test-org-00000001", otherOrganization.id]) {
			const volume = await createTestVolume({
				organizationId,
				status,
				type: "nfs",
				config: { backend: "nfs", server: "unused.invalid", exportPath: "/data", port: 2049, version: "4" },
			});
			const mountPath = path.join(volumeRoot, volume.shortId, "_data");
			await fs.mkdir(mountPath, { recursive: true });
			mounts.push({ mountPoint: mountPath, fstype: "nfs4" });
		}

		await cleanupDanglingVolumeMountDirectories();

		expect(unmountedPaths).toEqual([]);
		const dirs = await fs.readdir(volumeRoot);
		expect(dirs).toHaveLength(2);
		for (const dir of dirs) {
			await expect(fs.access(path.join(volumeRoot, dir, "_data"))).resolves.toBeNull();
		}
	},
);

test.each(["", "_data", "_data/source"])("preserves saved local directory sources at %s", async (child) => {
	const { volumeRoot, createTestVolume, cleanupDanglingVolumeMountDirectories } = await loadCleanup();
	const volumeDir = path.join(volumeRoot, "directory-source");
	const sourcePath = path.join(volumeDir, child);
	await createTestVolume({ status: "unmounted", config: { backend: "directory", path: sourcePath } });
	await fs.mkdir(path.join(volumeDir, "_data"), { recursive: true });
	await fs.mkdir(sourcePath, { recursive: true });

	await cleanupDanglingVolumeMountDirectories();

	await expect(fs.access(path.join(volumeDir, "_data"))).resolves.toBeNull();
	await expect(fs.access(sourcePath)).resolves.toBeNull();
});

test("remote-agent sources do not claim stale controller directories", async () => {
	const { volumeRoot, createTestVolume, cleanupDanglingVolumeMountDirectories } = await loadCleanup();
	const volumeDir = path.join(volumeRoot, "remote-source");
	await createTestVolume({ agentId: "remote-agent", config: { backend: "directory", path: volumeDir } });
	await fs.mkdir(path.join(volumeDir, "_data"), { recursive: true });

	await cleanupDanglingVolumeMountDirectories();

	await expect(fs.access(volumeDir)).rejects.toThrow();
});

test.each(["_data", ""])("preserves source data in nonempty candidates at %s", async (child) => {
	const { volumeRoot, cleanupDanglingVolumeMountDirectories } = await loadCleanup();
	const volumeDir = path.join(volumeRoot, "nonempty-volume");
	await fs.mkdir(path.join(volumeDir, "_data"), { recursive: true });
	const sourceFile = path.join(volumeDir, child, "backup-source.txt");
	await fs.writeFile(sourceFile, "keep this source data");

	await cleanupDanglingVolumeMountDirectories();

	expect(await fs.readFile(sourceFile, "utf8")).toBe("keep this source data");
});

test("a source appearing after the mount snapshot is never traversed", async () => {
	const { volumeRoot, cleanupDanglingVolumeMountDirectories } = await loadCleanup(async () => {
		const snapshot: { mountPoint: string; fstype: string }[] = [];
		await fs.writeFile(path.join(volumeRoot, "remounting-volume", "_data", "source.txt"), "live backend data");

		return snapshot;
	});
	const mountPath = path.join(volumeRoot, "remounting-volume", "_data");
	await fs.mkdir(mountPath, { recursive: true });

	await cleanupDanglingVolumeMountDirectories();

	expect(await fs.readFile(path.join(mountPath, "source.txt"), "utf8")).toBe("live backend data");
});

test("does not follow directory or _data symlinks outside the managed tree", async () => {
	const { tempRoot, volumeRoot, cleanupDanglingVolumeMountDirectories } = await loadCleanup();
	const sourcePath = path.join(tempRoot, "source");
	await fs.mkdir(path.join(sourcePath, "_data"), { recursive: true });
	await fs.symlink(sourcePath, path.join(volumeRoot, "linked-volume"));
	await fs.mkdir(path.join(volumeRoot, "linked-data"));
	await fs.symlink(path.join(sourcePath, "_data"), path.join(volumeRoot, "linked-data", "_data"));

	await cleanupDanglingVolumeMountDirectories();

	await expect(fs.access(path.join(sourcePath, "_data"))).resolves.toBeNull();
	expect((await fs.lstat(path.join(volumeRoot, "linked-volume"))).isSymbolicLink()).toBe(true);
	expect((await fs.lstat(path.join(volumeRoot, "linked-data", "_data"))).isSymbolicLink()).toBe(true);
});

test.each([
	["mount discovery", new Error("mount command failed")],
	["mount parser", new Error("Failed to parse non-empty mount command output")],
])("removes nothing when %s fails", async (_failureType, error) => {
	const { volumeRoot, cleanupDanglingVolumeMountDirectories } = await loadCleanup(async () => {
		throw error;
	});
	const volumeDir = path.join(volumeRoot, "preserved-volume");
	await fs.mkdir(path.join(volumeDir, "_data"), { recursive: true });

	await expect(cleanupDanglingVolumeMountDirectories()).rejects.toThrow(error.message);

	await expect(fs.access(path.join(volumeDir, "_data"))).resolves.toBeNull();
});

test("reclaims a canonical live orphan after a confirmed unmount", async () => {
	const mounts: { mountPoint: string; fstype: string }[] = [];
	const { volumeRoot, cleanupDanglingVolumeMountDirectories, unmountedPaths } = await loadCleanup(
		async () => mounts,
		async () => {
			mounts.length = 0;
		},
	);
	const volumeDir = path.join(volumeRoot, "orphan01");
	const mountPath = path.join(volumeDir, "_data");
	await fs.mkdir(mountPath, { recursive: true });
	mounts.push({ mountPoint: mountPath, fstype: "fuse.sshfs" });

	await cleanupDanglingVolumeMountDirectories();

	expect(unmountedPaths).toEqual([mountPath]);
	await expect(fs.access(volumeDir)).rejects.toThrow();
});

test.each([
	["", "absolute"],
	["source", "absolute"],
	["", "relative"],
])("preserves a live mount referenced through a saved directory alias at %s with a %s path", async (child, kind) => {
	const mounts: { mountPoint: string; fstype: string }[] = [];
	const { tempRoot, volumeRoot, createTestVolume, cleanupDanglingVolumeMountDirectories, unmountedPaths } =
		await loadCleanup(
			async () => mounts,
			async () => {
				mounts.length = 0;
			},
			kind === "relative" ? process.cwd() : os.tmpdir(),
		);
	const mountPath = path.join(volumeRoot, "orphan01", "_data");
	await fs.mkdir(path.join(mountPath, child), { recursive: true });
	const aliasPath = path.join(tempRoot, "selected-folder");
	await fs.symlink(mountPath, aliasPath);
	const sourcePath = path.join(aliasPath, child);
	const savedPath = kind === "relative" ? path.relative(process.cwd(), sourcePath) : sourcePath;
	await createTestVolume({ config: { backend: "directory", path: savedPath } });
	mounts.push({ mountPoint: mountPath, fstype: "fuse.sshfs" });

	await cleanupDanglingVolumeMountDirectories();

	expect(unmountedPaths).toEqual([]);
	expect(mounts).toEqual([{ mountPoint: mountPath, fstype: "fuse.sshfs" }]);
	await expect(fs.access(savedPath)).resolves.toBeNull();
});

test("preserves a saved canonical source when the candidate uses the system temporary path alias", async () => {
	const mounts: { mountPoint: string; fstype: string }[] = [];
	const { volumeRoot, createTestVolume, cleanupDanglingVolumeMountDirectories, unmountedPaths } = await loadCleanup(
		async () => mounts,
		async () => {
			mounts.length = 0;
		},
		"/tmp",
	);
	const mountPath = path.join(volumeRoot, "orphan01", "_data");
	await fs.mkdir(mountPath, { recursive: true });
	const savedPath = await fs.realpath(mountPath);
	await createTestVolume({ config: { backend: "directory", path: savedPath } });
	mounts.push({ mountPoint: mountPath, fstype: "nfs4" });

	await cleanupDanglingVolumeMountDirectories();

	expect(unmountedPaths).toEqual([]);
	await expect(fs.access(savedPath)).resolves.toBeNull();
});

test.each(["absolute", "relative"])(
	"preserves a saved %s source using an alias before parent traversal",
	async (kind) => {
		const mounts: { mountPoint: string; fstype: string }[] = [];
		const { tempRoot, volumeRoot, createTestVolume, cleanupDanglingVolumeMountDirectories, unmountedPaths } =
			await loadCleanup(
				async () => mounts,
				async () => {
					mounts.length = 0;
				},
			);
		const mountPath = path.join(volumeRoot, "orphan01", "_data");
		await fs.mkdir(path.join(mountPath, "child"), { recursive: true });
		const selectionPath = path.join(tempRoot, "selection");
		await fs.mkdir(selectionPath);
		const aliasPath = path.join(selectionPath, "selected-folder");
		await fs.symlink(path.join(mountPath, "child"), aliasPath);
		const rawPath = `${aliasPath}/..`;
		const savedPath = kind === "relative" ? `${path.relative(process.cwd(), aliasPath)}/..` : rawPath;
		await createTestVolume({ config: { backend: "directory", path: savedPath } });
		mounts.push({ mountPoint: mountPath, fstype: "fuse.sshfs" });
		const { makeDirectoryBackend } = await import("../backends/directory");
		const backend = makeDirectoryBackend({ backend: "directory", path: savedPath }, "unused");
		expect(await backend.checkHealth()).toEqual({ status: "mounted" });
		expect((await fs.stat(savedPath)).ino).toBe((await fs.stat(mountPath)).ino);
		expect((await fs.stat(path.resolve(savedPath))).ino).not.toBe((await fs.stat(mountPath)).ino);

		await cleanupDanglingVolumeMountDirectories();

		expect(unmountedPaths).toEqual([]);
		expect(mounts).toEqual([{ mountPoint: mountPath, fstype: "fuse.sshfs" }]);
		expect(await backend.checkHealth()).toEqual({ status: "mounted" });
	},
);

test.for(["dangling-alias", "missing-child", "symlink-loop", "permission"])(
	"preserves a live candidate when an unavailable saved source has %s",
	async (kind, context) => {
		if (kind === "permission" && process.getuid?.() === 0) context.skip();

		const mounts: { mountPoint: string; fstype: string }[] = [];
		const { tempRoot, volumeRoot, createTestVolume, cleanupDanglingVolumeMountDirectories, unmountedPaths } =
			await loadCleanup(async () => mounts);
		const mountPath = path.join(volumeRoot, "orphan01", "_data");
		await fs.mkdir(mountPath, { recursive: true });
		const aliasPath = path.join(tempRoot, "selected-folder");
		if (kind === "missing-child") await fs.symlink(mountPath, aliasPath);
		if (kind === "dangling-alias") await fs.symlink(path.join(tempRoot, "unavailable"), aliasPath);
		if (kind === "symlink-loop") await fs.symlink(aliasPath, aliasPath);
		if (kind === "permission") {
			await fs.mkdir(path.join(aliasPath, "source"), { recursive: true });
			await fs.chmod(aliasPath, 0);
		}
		const savedPath =
			kind === "missing-child"
				? path.join(aliasPath, "unavailable")
				: kind === "permission"
					? path.join(aliasPath, "source")
					: aliasPath;
		await createTestVolume({ status: "error", config: { backend: "directory", path: savedPath } });
		mounts.push({ mountPoint: mountPath, fstype: "nfs4" });

		try {
			await cleanupDanglingVolumeMountDirectories();

			expect(unmountedPaths).toEqual([]);
			await expect(fs.access(mountPath)).resolves.toBeNull();
		} finally {
			if (kind === "permission") await fs.chmod(aliasPath, 0o700);
		}
	},
);

test("reclaims an orphan independently of a missing unmounted managed source", async () => {
	const mounts: { mountPoint: string; fstype: string }[] = [];
	const { volumeRoot, createTestVolume, cleanupDanglingVolumeMountDirectories, unmountedPaths } = await loadCleanup(
		async () => mounts,
		async () => {
			mounts.length = 0;
		},
	);
	await createTestVolume({
		shortId: asShortId("saved001"),
		status: "unmounted",
		type: "nfs",
		config: { backend: "nfs", server: "unused.invalid", exportPath: "/data", port: 2049, version: "4" },
	});
	const volumeDir = path.join(volumeRoot, "orphan01");
	const mountPath = path.join(volumeDir, "_data");
	await fs.mkdir(mountPath, { recursive: true });
	mounts.push({ mountPoint: mountPath, fstype: "nfs4" });

	await cleanupDanglingVolumeMountDirectories();

	expect(unmountedPaths).toEqual([mountPath]);
	await expect(fs.access(volumeDir)).rejects.toThrow();
});

test("reclaims a live orphan independently of a resolvable saved directory alias", async () => {
	const mounts: { mountPoint: string; fstype: string }[] = [];
	const { tempRoot, volumeRoot, createTestVolume, cleanupDanglingVolumeMountDirectories, unmountedPaths } =
		await loadCleanup(
			async () => mounts,
			async () => {
				mounts.length = 0;
			},
		);
	const sourcePath = path.join(tempRoot, "source");
	await fs.mkdir(sourcePath);
	const savedPath = path.join(tempRoot, "selected-folder");
	await fs.symlink(sourcePath, savedPath);
	await createTestVolume({ config: { backend: "directory", path: savedPath } });
	const volumeDir = path.join(volumeRoot, "orphan01");
	const mountPath = path.join(volumeDir, "_data");
	await fs.mkdir(mountPath, { recursive: true });
	mounts.push({ mountPoint: mountPath, fstype: "fuse.sshfs" });

	await cleanupDanglingVolumeMountDirectories();

	expect(unmountedPaths).toEqual([mountPath]);
	await expect(fs.access(volumeDir)).rejects.toThrow();
	await expect(fs.access(savedPath)).resolves.toBeNull();
});

test.each(["failure", "still-mounted", "data"])(
	"preserves an orphan with %s after the unmount attempt",
	async (outcome) => {
		const mounts: { mountPoint: string; fstype: string }[] = [];
		const { volumeRoot, cleanupDanglingVolumeMountDirectories, unmountedPaths } = await loadCleanup(
			async () => mounts,
			async () => {
				if (outcome === "failure") throw new Error("unmount failed");
				if (outcome === "data") mounts.length = 0;
			},
		);
		const mountPath = path.join(volumeRoot, "orphan01", "_data");
		await fs.mkdir(mountPath, { recursive: true });
		await fs.writeFile(path.join(mountPath, "source.txt"), "keep source");
		mounts.push({ mountPoint: mountPath, fstype: "nfs4" });

		await cleanupDanglingVolumeMountDirectories();

		expect(unmountedPaths).toEqual([mountPath]);
		expect(await fs.readFile(path.join(mountPath, "source.txt"), "utf8")).toBe("keep source");
	},
);

test.each(["saved", "concurrent"])("protects a %s managed source from orphan unmount", async (timing) => {
	const mounts: { mountPoint: string; fstype: string }[] = [];
	let mountReads = 0;
	const setup = await loadCleanup(async () => {
		mountReads += 1;
		if (timing === "concurrent" && mountReads === 2) {
			await setup.createTestVolume({
				shortId: asShortId("orphan01"),
				type: "nfs",
				status: "error",
				config: { backend: "nfs", server: "unused.invalid", exportPath: "/data", port: 2049, version: "4" },
			});
		}
		return mounts;
	});
	const mountPath = path.join(setup.volumeRoot, "orphan01", "_data");
	await fs.mkdir(mountPath, { recursive: true });
	if (timing === "saved") await setup.createTestVolume({ config: { backend: "directory", path: mountPath } });
	mounts.push({ mountPoint: mountPath, fstype: "nfs4" });

	await setup.cleanupDanglingVolumeMountDirectories();

	expect(setup.unmountedPaths).toEqual([]);
	await expect(fs.access(mountPath)).resolves.toBeNull();
});

test.each(["nested", "foreign", "symlink", "noncanonical"])("does not unmount %s paths", async (kind) => {
	const mounts: { mountPoint: string; fstype: string }[] = [];
	const { tempRoot, volumeRoot, cleanupDanglingVolumeMountDirectories, unmountedPaths } = await loadCleanup(
		async () => mounts,
	);
	const volumeDir = path.join(volumeRoot, kind === "noncanonical" ? "invalid-id" : "orphan01");
	const mountPath = path.join(volumeDir, "_data");
	await fs.mkdir(volumeDir);
	if (kind === "symlink") {
		await fs.mkdir(path.join(tempRoot, "source"));
		await fs.symlink(path.join(tempRoot, "source"), mountPath);
	} else await fs.mkdir(mountPath);
	mounts.push({ mountPoint: kind === "foreign" ? volumeDir : mountPath, fstype: "nfs4" });
	if (kind === "nested") mounts.push({ mountPoint: path.join(mountPath, "nested"), fstype: "nfs4" });

	await cleanupDanglingVolumeMountDirectories();

	expect(unmountedPaths).toEqual([]);
	await expect(fs.lstat(mountPath)).resolves.toBeDefined();
});

test("retries an orphan on the next cleanup after unmount fails", async () => {
	const mounts: { mountPoint: string; fstype: string }[] = [];
	let attempts = 0;
	const { volumeRoot, cleanupDanglingVolumeMountDirectories, unmountedPaths } = await loadCleanup(
		async () => mounts,
		async () => {
			attempts += 1;
			if (attempts === 1) throw new Error("busy mount");
			mounts.length = 0;
		},
	);
	const volumeDir = path.join(volumeRoot, "orphan01");
	const mountPath = path.join(volumeDir, "_data");
	await fs.mkdir(mountPath, { recursive: true });
	mounts.push({ mountPoint: mountPath, fstype: "nfs4" });

	await cleanupDanglingVolumeMountDirectories();
	await expect(fs.access(mountPath)).resolves.toBeNull();

	await cleanupDanglingVolumeMountDirectories();

	expect(unmountedPaths).toEqual([mountPath, mountPath]);
	await expect(fs.access(volumeDir)).rejects.toThrow();
});
