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
	listSourceMachinesDto,
	type ListSourceMachinesDto,
} from "./volume.dto";
import { volumeService } from "./volume.service";
import { requireAuth } from "../auth/auth.middleware";
import type { Volume } from "../../db/schema";
import { asShortId } from "~/server/utils/branded";

const toPublicVolume = ({ organizationId: _organizationId, ...volume }: Volume) => volume;

export const volumeController = new Hono()
	.use(requireAuth)
	.get("/", listVolumesDto, async (c) => {
		const volumes = await volumeService.listVolumes();
		const response = volumes.map(toPublicVolume);

		return c.json<ListVolumesDto>(response, 200);
	})
	.get("/source-machines", listSourceMachinesDto, async (c) => {
		const machines = await volumeService.listSourceMachines();
		return c.json<ListSourceMachinesDto>(machines, 200);
	})
	.post("/", createVolumeDto, validator("json", createVolumeBody), async (c) => {
		const body = c.req.valid("json");
		const res = await volumeService.createVolume(body, c.req.raw.signal);

		const response = toPublicVolume(res.volume);

		return c.json<CreateVolumeDto>(response, 201);
	})
	.post("/test-connection", testConnectionDto, validator("json", testConnectionBody), async (c) => {
		const body = c.req.valid("json");
		const result = await volumeService.testConnection(body.config);

		return c.json(result, 200);
	})
	.delete("/:shortId", deleteVolumeDto, async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		await volumeService.deleteVolume(shortId);

		return c.json({ message: "Volume deleted" }, 200);
	})
	.get("/:shortId", getVolumeDto, async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const res = await volumeService.getVolume(shortId, c.req.raw.signal);

		const response = {
			volume: toPublicVolume(res.volume),
			statfs: {
				total: res.statfs.total ?? 0,
				used: res.statfs.used ?? 0,
				free: res.statfs.free ?? 0,
			},
		};

		return c.json<GetVolumeDto>(response, 200);
	})
	.put("/:shortId", updateVolumeDto, validator("json", updateVolumeBody), async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const body = c.req.valid("json");
		const res = await volumeService.updateVolume(shortId, body, c.req.raw.signal);

		const response = toPublicVolume(res.volume);

		return c.json<UpdateVolumeDto>(response, 200);
	})
	.post("/:shortId/mount", mountVolumeDto, async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const { error, status } = await volumeService.mountVolume(shortId);

		return c.json({ error, status }, error ? 500 : 200);
	})
	.post("/:shortId/unmount", unmountVolumeDto, async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const { error, status } = await volumeService.unmountVolume(shortId);

		return c.json({ error, status }, error ? 500 : 200);
	})
	.post("/:shortId/health-check", healthCheckDto, async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const { error, status } = await volumeService.checkHealth(shortId, c.req.raw.signal);

		return c.json({ error, status }, 200);
	})
	.get("/:shortId/files", validator("query", listFilesQuery), listFilesDto, async (c) => {
		const shortId = asShortId(c.req.param("shortId"));
		const { path, ...query } = c.req.valid("query");

		const offset = Math.max(0, query.offset ?? 0);
		const limit = Math.min(1000, Math.max(1, query.limit ?? 500));

		const result = await volumeService.listFiles(shortId, path, offset, limit, c.req.raw.signal);

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
		const browsePath = c.req.query("path") ?? "";
		const agentId = c.req.query("agentId") || "local";
		const rootId = c.req.query("rootId") || "local-filesystem";
		const result = await volumeService.browseFilesystem(agentId, rootId, browsePath, c.req.raw.signal);

		const response = {
			directories: result.directories,
			path: result.path,
		};

		return c.json<BrowseFilesystemDto>(response, 200);
	});
