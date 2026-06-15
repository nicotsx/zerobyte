import { z } from "zod";
import { describeRoute } from "hono-openapi";
import { DATE_FORMATS, TIME_FORMATS } from "~/lib/datetime";

export const createDesktopSessionBody = z.object({
	dateFormat: z.enum(DATE_FORMATS),
	timeFormat: z.enum(TIME_FORMATS),
});

export type CreateDesktopSessionBody = z.infer<typeof createDesktopSessionBody>;

export const createDesktopSessionDto = describeRoute({
	description: "Create an authenticated desktop session",
	operationId: "createDesktopSession",
	tags: ["Desktop"],
	responses: {
		200: {
			description: "Desktop session created successfully",
		},
	},
});
