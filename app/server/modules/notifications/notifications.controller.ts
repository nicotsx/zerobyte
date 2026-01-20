import { Hono } from "hono";
import { validator } from "hono-openapi";
import {
	createDestinationBody,
	createDestinationDto,
	deleteDestinationDto,
	getDestinationDto,
	listDestinationsDto,
	testDestinationDto,
	updateDestinationBody,
	updateDestinationDto,
	type CreateDestinationDto,
	type DeleteDestinationDto,
	type GetDestinationDto,
	type ListDestinationsDto,
	type TestDestinationDto,
	type UpdateDestinationDto,
} from "./notifications.dto";
import { notificationsService } from "./notifications.service";
import { requireAuth } from "../auth/auth.middleware";

export const notificationsController = new Hono()
	.use(requireAuth)
	.get("/destinations", listDestinationsDto, async (c) => {
		const destinations = await notificationsService.listDestinations();
		return c.json<ListDestinationsDto>(destinations, 200);
	})
	.post("/destinations", createDestinationDto, validator("json", createDestinationBody), async (c) => {
		const body = c.req.valid("json");
		const destination = await notificationsService.createDestination(body.name, body.config);
		return c.json<CreateDestinationDto>(destination, 201);
	})
	.get("/destinations/:id", getDestinationDto, async (c) => {
		const id = Number.parseInt(c.req.param("id"), 10);
		const destination = await notificationsService.getDestination(id);
		return c.json<GetDestinationDto>(destination, 200);
	})
	.patch("/destinations/:id", updateDestinationDto, validator("json", updateDestinationBody), async (c) => {
		const id = Number.parseInt(c.req.param("id"), 10);
		const body = c.req.valid("json");
		const destination = await notificationsService.updateDestination(id, body);
		return c.json<UpdateDestinationDto>(destination, 200);
	})
	.delete("/destinations/:id", deleteDestinationDto, async (c) => {
		const id = Number.parseInt(c.req.param("id"), 10);
		await notificationsService.deleteDestination(id);
		return c.json<DeleteDestinationDto>({ message: "Notification destination deleted" }, 200);
	})
	.post("/destinations/:id/test", testDestinationDto, async (c) => {
		const id = Number.parseInt(c.req.param("id"), 10);
		const result = await notificationsService.testDestination(id);
		return c.json<TestDestinationDto>(result, 200);
	});
