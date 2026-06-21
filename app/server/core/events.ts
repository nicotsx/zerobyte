import { EventEmitter } from "node:events";
import type { TypedEmitter } from "tiny-typed-emitter";
import type { ServerEventHandlers } from "~/schemas/server-events";

/**
 * Global event emitter for server-side events
 * Use this to emit events that should be broadcasted to connected clients via SSE
 */
const serverEventEmitter = new EventEmitter();
serverEventEmitter.setMaxListeners(100);

export const serverEvents = serverEventEmitter as TypedEmitter<ServerEventHandlers>;
