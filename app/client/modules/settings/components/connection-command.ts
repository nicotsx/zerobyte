const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

export const createConnectionCommand = (controllerUrl: string, code: string, rootPath: string) => {
	const controller = new URL(controllerUrl);
	if (controller.protocol !== "wss:") throw new Error("Remote enrollment requires TLS");
	controller.protocol = "https:";
	const origin = shellQuote(controller.origin);
	const downloadUrl = shellQuote(new URL("/api/v1/agents/download", controller).toString());
	const enrollmentCode = shellQuote(code);
	const allowedRoot = shellQuote(rootPath);
	return `curl --fail --proto '=https' --output zerobyte-agent.mjs ${downloadUrl} && bun ./zerobyte-agent.mjs enroll --controller ${origin} --code ${enrollmentCode} --root ${allowedRoot}`;
};
