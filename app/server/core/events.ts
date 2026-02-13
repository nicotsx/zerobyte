import { EventEmitter } from "node:events";
import type { TypedEmitter } from "tiny-typed-emitter";
import type { ServerEventHandlers } from "~/schemas/server-events";
export type { ServerEventHandlers, ServerEventPayloadMap } from "~/schemas/server-events";

/**
 * Global event emitter for server-side events
 * Use this to emit events that should be broadcasted to connected clients via SSE
 */
export const serverEvents = new EventEmitter() as TypedEmitter<ServerEventHandlers>;
