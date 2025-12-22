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
import { requireAuth } from "../auth/auth.middleware";

export const repositoriesController = new Hono()
	.use(requireAuth)
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
	.get("/:id", getRepositoryDto, async (c) => {
		const { id } = c.req.param();
		const res = await repositoriesService.getRepository(id);

		return c.json<GetRepositoryDto>(res.repository, 200);
	})
	.delete("/:id", deleteRepositoryDto, async (c) => {
		const { id } = c.req.param();
		await repositoriesService.deleteRepository(id);

		return c.json<DeleteRepositoryDto>({ message: "Repository deleted" }, 200);
	})
	.get("/:id/snapshots", listSnapshotsDto, validator("query", listSnapshotsFilters), async (c) => {
		const { id } = c.req.param();
		const { backupId } = c.req.valid("query");

		const res = await repositoriesService.listSnapshots(id, backupId);

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
	.get("/:id/snapshots/:snapshotId", getSnapshotDetailsDto, async (c) => {
		const { id, snapshotId } = c.req.param();
		const snapshot = await repositoriesService.getSnapshotDetails(id, snapshotId);

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
		"/:id/snapshots/:snapshotId/files",
		listSnapshotFilesDto,
		validator("query", listSnapshotFilesQuery),
		async (c) => {
			const { id, snapshotId } = c.req.param();
			const { path } = c.req.valid("query");

			const decodedPath = path ? decodeURIComponent(path) : undefined;
			const result = await repositoriesService.listSnapshotFiles(id, snapshotId, decodedPath);

			c.header("Cache-Control", "max-age=300, stale-while-revalidate=600");

			return c.json<ListSnapshotFilesDto>(result, 200);
		},
	)
	.post("/:id/restore", restoreSnapshotDto, validator("json", restoreSnapshotBody), async (c) => {
		const { id } = c.req.param();
		const { snapshotId, ...options } = c.req.valid("json");

		const result = await repositoriesService.restoreSnapshot(id, snapshotId, options);

		return c.json<RestoreSnapshotDto>(result, 200);
	})
	.post("/:id/doctor", doctorRepositoryDto, async (c) => {
		const { id } = c.req.param();

		const result = await repositoriesService.doctorRepository(id);

		return c.json<DoctorRepositoryDto>(result, 200);
	})
	.delete("/:id/snapshots/:snapshotId", deleteSnapshotDto, async (c) => {
		const { id, snapshotId } = c.req.param();

		await repositoriesService.deleteSnapshot(id, snapshotId);

		return c.json<DeleteSnapshotDto>({ message: "Snapshot deleted" }, 200);
	})
	.patch("/:id", updateRepositoryDto, validator("json", updateRepositoryBody), async (c) => {
		const { id } = c.req.param();
		const body = c.req.valid("json");

		const res = await repositoriesService.updateRepository(id, body);

		return c.json<UpdateRepositoryDto>(res.repository, 200);
	});
