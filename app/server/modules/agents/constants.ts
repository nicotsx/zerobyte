import path from "node:path";
import type { AgentCapabilities, AgentKind } from "../../db/schema";

export const LOCAL_AGENT_ID = "local";
export const LOCAL_AGENT_NAME = "Local Agent";
export const LOCAL_AGENT_KIND = "local" satisfies AgentKind;
export const LOCAL_AGENT_CAPABILITIES: AgentCapabilities = {};
export const REMOTE_AGENTS_UNAVAILABLE = "Remote agents are disabled on this instance.";
export const AGENT_BUNDLE_PATH = path.join(process.cwd(), ".output", "agent", "index.mjs");
