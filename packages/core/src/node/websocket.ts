export type WebSocketRawData = Buffer | ArrayBuffer | Buffer[];

export const webSocketRawDataToString = (data: WebSocketRawData) =>
	(Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)).toString();
