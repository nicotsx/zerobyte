import { Hono } from "hono";
import { validator } from "hono-openapi";
import {
	createRepositoryBody,
	createRepositoryDto,
	deleteRepositoryDto,
	deleteSnapshotDto,
	doctorRepositoryDto,
	getRepositoryDto,
	getSnapshotDetailsDto,
	listRcloneRemotesDto,
	listRepositoriesDto,
	listSnapshotFilesDto,
	listSnapshotFilesQuery,
	listSnapshotsDto,
	listSnapshotsFilters,
	restoreSnapshotBody,
	restoreSnapshotDto,
	updateRepositoryBody,
	updateRepositoryDto,
	type DeleteRepositoryDto,
	type DeleteSnapshotDto,
	type DoctorRepositoryDto,
	type GetRepositoryDto,
	type GetSnapshotDetailsDto,
	type ListRepositoriesDto,
	type ListSnapshotFilesDto,
	type ListSnapshotsDto,
	type RestoreSnapshotDto,
	type UpdateRepositoryDto,
} from "./repositories.dto";
import { repositoriesService } from "./repositories.service";
import { getRcloneRemoteInfo, listRcloneRemotes } from "../../utils/rclone";

export const repositoriesController = new Hono()
	.get("/", listRepositoriesDto, async (c) => {
		const repositories = await repositoriesService.listRepositories();

		return c.json<ListRepositoriesDto>(repositories, 200);
	})
	.post("/", createRepositoryDto, validator("json", createRepositoryBody), async (c) => {
		const body = c.req.valid("json");
		const res = await repositoriesService.createRepository(body.name, body.config, body.compressionMode);

		return c.json({ message: "Repository created", repository: res.repository }, 201);
	})
	.get("/rclone-remotes", listRcloneRemotesDto, async (c) => {
		const remoteNames = await listRcloneRemotes();

		const remotes = await Promise.all(
			remoteNames.map(async (name) => {
				const info = await getRcloneRemoteInfo(name);
				return {
					name,
					type: info?.type ?? "unknown",
				};
			}),
		);

		return c.json(remotes);
	})
	.get("/:name", getRepositoryDto, async (c) => {
		const { name } = c.req.param();
		const res = await repositoriesService.getRepository(name);

		return c.json<GetRepositoryDto>(res.repository, 200);
	})
	.delete("/:name", deleteRepositoryDto, async (c) => {
		const { name } = c.req.param();
		await repositoriesService.deleteRepository(name);

		return c.json<DeleteRepositoryDto>({ message: "Repository deleted" }, 200);
	})
	.get("/:name/snapshots", listSnapshotsDto, validator("query", listSnapshotsFilters), async (c) => {
		const { name } = c.req.param();
		const { backupId } = c.req.valid("query");

		const res = await repositoriesService.listSnapshots(name, backupId);

		const snapshots = res.map((snapshot) => {
			const { summary } = snapshot;

			let duration = 0;
			if (summary) {
				const { backup_start, backup_end } = summary;
				duration = new Date(backup_end).getTime() - new Date(backup_start).getTime();
			}

			return {
				short_id: snapshot.short_id,
				duration,
				paths: snapshot.paths,
				tags: snapshot.tags ?? [],
				size: summary?.total_bytes_processed || 0,
				time: new Date(snapshot.time).getTime(),
			};
		});

		return c.json<ListSnapshotsDto>(snapshots, 200);
	})
	.get("/:name/snapshots/:snapshotId", getSnapshotDetailsDto, async (c) => {
		const { name, snapshotId } = c.req.param();
		const snapshot = await repositoriesService.getSnapshotDetails(name, snapshotId);

		let duration = 0;
		if (snapshot.summary) {
			const { backup_start, backup_end } = snapshot.summary;
			duration = new Date(backup_end).getTime() - new Date(backup_start).getTime();
		}

		const response = {
			short_id: snapshot.short_id,
			duration,
			time: new Date(snapshot.time).getTime(),
			paths: snapshot.paths,
			size: snapshot.summary?.total_bytes_processed || 0,
			tags: snapshot.tags ?? [],
			summary: snapshot.summary,
		};

		return c.json<GetSnapshotDetailsDto>(response, 200);
	})
	.get(
		"/:name/snapshots/:snapshotId/files",
		listSnapshotFilesDto,
		validator("query", listSnapshotFilesQuery),
		async (c) => {
			const { name, snapshotId } = c.req.param();
			const { path } = c.req.valid("query");

			const decodedPath = path ? decodeURIComponent(path) : undefined;
			const result = await repositoriesService.listSnapshotFiles(name, snapshotId, decodedPath);

			c.header("Cache-Control", "max-age=300, stale-while-revalidate=600");

			return c.json<ListSnapshotFilesDto>(result, 200);
		},
	)
	.post("/:name/restore", restoreSnapshotDto, validator("json", restoreSnapshotBody), async (c) => {
		const { name } = c.req.param();
		const { snapshotId, ...options } = c.req.valid("json");

		const result = await repositoriesService.restoreSnapshot(name, snapshotId, options);

		return c.json<RestoreSnapshotDto>(result, 200);
	})
	.post("/:name/doctor", doctorRepositoryDto, async (c) => {
		const { name } = c.req.param();

		const result = await repositoriesService.doctorRepository(name);

		return c.json<DoctorRepositoryDto>(result, 200);
	})
	.delete("/:name/snapshots/:snapshotId", deleteSnapshotDto, async (c) => {
		const { name, snapshotId } = c.req.param();

		await repositoriesService.deleteSnapshot(name, snapshotId);

		return c.json<DeleteSnapshotDto>({ message: "Snapshot deleted" }, 200);
	})
	.patch("/:name", updateRepositoryDto, validator("json", updateRepositoryBody), async (c) => {
		const { name } = c.req.param();
		const body = c.req.valid("json");

		const res = await repositoriesService.updateRepository(name, body);

		return c.json<UpdateRepositoryDto>(res.repository, 200);
	});
