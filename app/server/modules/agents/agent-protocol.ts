import { z } from "zod";
import { safeJsonParse } from "~/server/utils/json";

const backupCommandSchema = z
	.object({
		type: z.literal("backup"),
		payload: z.object({ scheduleId: z.string() }),
	})
	.strict();

const agentReadySchema = z
	.object({
		type: z.literal("agent.ready"),
		payload: z.object({ agentId: z.string() }),
	})
	.strict();

const backupStartedSchema = z
	.object({
		type: z.literal("backup.started"),
		payload: z.object({ scheduleId: z.string() }),
	})
	.strict();

const controllerMessageSchema = z.discriminatedUnion("type", [backupCommandSchema]);
const agentMessageSchema = z.discriminatedUnion("type", [agentReadySchema, backupStartedSchema]);

export type BackupCommandPayload = z.infer<typeof backupCommandSchema>["payload"];
export type ControllerMessage = z.infer<typeof controllerMessageSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;

type Brand<TValue, TBrand extends string> = TValue & {
	readonly __brand: TBrand;
};

type MessageSender = {
	send(message: string): unknown;
};

export type ControllerWireMessage = Brand<string, "ControllerWireMessage">;
export type AgentWireMessage = Brand<string, "AgentWireMessage">;

type PayloadForMessage<TMessage extends { type: string; payload: unknown }, TType extends TMessage["type"]> = Extract<
	TMessage,
	{ type: TType }
>["payload"];

const parseJsonMessage = (data: string) => safeJsonParse<unknown>(data);

export const parseControllerMessage = (data: ControllerWireMessage) => {
	const parsed = parseJsonMessage(data);
	if (parsed === null) {
		return null;
	}

	return controllerMessageSchema.safeParse(parsed);
};

export const parseAgentMessage = (data: string) => {
	const parsed = parseJsonMessage(data);
	if (parsed === null) {
		return null;
	}

	return agentMessageSchema.safeParse(parsed);
};

export const createControllerMessage = <TType extends ControllerMessage["type"]>(
	type: TType,
	payload: PayloadForMessage<ControllerMessage, TType>,
) =>
	JSON.stringify(
		controllerMessageSchema.parse({
			type,
			payload,
		}),
	) as ControllerWireMessage;

export const createAgentMessage = <TType extends AgentMessage["type"]>(
	type: TType,
	payload: PayloadForMessage<AgentMessage, TType>,
) =>
	JSON.stringify(
		agentMessageSchema.parse({
			type,
			payload,
		}),
	) as AgentWireMessage;

export const sendControllerMessage = (target: MessageSender, message: ControllerWireMessage) => {
	target.send(message);
};

export const sendAgentMessage = (target: MessageSender, message: AgentWireMessage) => {
	target.send(message);
};

export type ControllerData = MessageEvent<ControllerWireMessage>;
