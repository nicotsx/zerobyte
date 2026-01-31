import { Hono } from "hono";
import { validator } from "hono-openapi";
import {
	createVolumeBody,
	createVolumeDto,
	deleteVolumeDto,
	getVolumeDto,
	healthCheckDto,
	type ListVolumesDto,
	listFilesDto,
	listVolumesDto,
	mountVolumeDto,
	testConnectionBody,
	testConnectionDto,
	unmountVolumeDto,
	updateVolumeBody,
	updateVolumeDto,
	type CreateVolumeDto,
	type GetVolumeDto,
	type UpdateVolumeDto,
	type ListFilesDto,
	browseFilesystemDto,
	type BrowseFilesystemDto,
	listFilesQuery,
} from "./volume.dto";
import { volumeService } from "./volume.service";
import { getVolumePath } from "./helpers";
import { requireAuth } from "../auth/auth.middleware";

export const volumeController = new Hono()
	.use(requireAuth)
	.get("/", listVolumesDto, async (c) => {
		const volumes = await volumeService.listVolumes();

		return c.json<ListVolumesDto>(volumes, 200);
	})
	.post("/", createVolumeDto, validator("json", createVolumeBody), async (c) => {
		const body = c.req.valid("json");
		const res = await volumeService.createVolume(body.name, body.config);

		const response = {
			...res.volume,
			path: getVolumePath(res.volume),
		};

		return c.json<CreateVolumeDto>(response, 201);
	})
	.post("/test-connection", testConnectionDto, validator("json", testConnectionBody), async (c) => {
		const body = c.req.valid("json");
		const result = await volumeService.testConnection(body.config);

		return c.json(result, 200);
	})
	.delete("/:id", deleteVolumeDto, async (c) => {
		const { id } = c.req.param();
		await volumeService.deleteVolume(id);

		return c.json({ message: "Volume deleted" }, 200);
	})
	.get("/:id", getVolumeDto, async (c) => {
		const { id } = c.req.param();
		const res = await volumeService.getVolume(id);

		const response = {
			volume: {
				...res.volume,
				path: getVolumePath(res.volume),
			},
			statfs: {
				total: res.statfs.total ?? 0,
				used: res.statfs.used ?? 0,
				free: res.statfs.free ?? 0,
			},
		};

		return c.json<GetVolumeDto>(response, 200);
	})
	.put("/:id", updateVolumeDto, validator("json", updateVolumeBody), async (c) => {
		const { id } = c.req.param();
		const body = c.req.valid("json");
		const res = await volumeService.updateVolume(id, body);

		const response = {
			...res.volume,
			path: getVolumePath(res.volume),
		};

		return c.json<UpdateVolumeDto>(response, 200);
	})
	.post("/:id/mount", mountVolumeDto, async (c) => {
		const { id } = c.req.param();
		const { error, status } = await volumeService.mountVolume(id);

		return c.json({ error, status }, error ? 500 : 200);
	})
	.post("/:id/unmount", unmountVolumeDto, async (c) => {
		const { id } = c.req.param();
		const { error, status } = await volumeService.unmountVolume(id);

		return c.json({ error, status }, error ? 500 : 200);
	})
	.post("/:id/health-check", healthCheckDto, async (c) => {
		const { id } = c.req.param();
		const { error, status } = await volumeService.checkHealth(id);

		return c.json({ error, status }, 200);
	})
	.get("/:id/files", validator("query", listFilesQuery), listFilesDto, async (c) => {
		const { id } = c.req.param();
		const { path, ...query } = c.req.valid("query");

		const offset = Math.max(0, Number.parseInt(query.offset ?? "0", 10) || 0);
		const limit = Math.min(1000, Math.max(1, Number.parseInt(query.limit ?? "500", 10) || 500));

		const result = await volumeService.listFiles(id, path, offset, limit);

		const response = {
			files: result.files,
			path: result.path,
			offset: result.offset,
			limit: result.limit,
			total: result.total,
			hasMore: result.hasMore,
		};

		c.header("Cache-Control", "public, max-age=10, stale-while-revalidate=60");

		return c.json<ListFilesDto>(response, 200);
	})
	.get("/filesystem/browse", browseFilesystemDto, async (c) => {
		const path = c.req.query("path") || "/";
		const result = await volumeService.browseFilesystem(path);

		const response = {
			directories: result.directories,
			path: result.path,
		};

		return c.json<BrowseFilesystemDto>(response, 200);
	});
