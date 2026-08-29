import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { apiDocsConfiguration } from "../app/server/api-docs";
import { createApp } from "../app/server/app";

const outputDirectory = "dist/api-docs";
const app = createApp();

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const openApiResponse = await app.request("http://localhost/api/v1/openapi.json");
if (!openApiResponse.ok) {
	throw new Error(`Failed to export OpenAPI document: ${openApiResponse.status}`);
}

const openApi = await openApiResponse.text();
const staticDocsConfiguration = {
	...apiDocsConfiguration,
	content: openApi,
};
const staticDocsApp = new Hono();
staticDocsApp.get("/", Scalar(staticDocsConfiguration));

const docsResponse = await staticDocsApp.request("http://localhost");
if (!docsResponse.ok) {
	throw new Error(`Failed to export API docs: ${docsResponse.status}`);
}

const docs = await docsResponse.text();

await writeFile(join(outputDirectory, "index.html"), docs);
await writeFile(join(outputDirectory, "openapi.json"), openApi);
