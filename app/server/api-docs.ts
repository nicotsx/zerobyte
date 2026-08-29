import { Scalar } from "@scalar/hono-api-reference";
import type { Hono } from "hono";
import { openAPIRouteHandler } from "hono-openapi";

export const createOpenApiHandler = (app: Hono) =>
	openAPIRouteHandler(app, {
		documentation: {
			info: {
				title: "Zerobyte API",
				version: "1.0.0",
				description: "API for managing volumes",
			},
		},
	});

const apiDocsCustomCss = `
.dark-mode {
  --scalar-color-1: #fafafa;
  --scalar-color-2: #a3a3a3;
  --scalar-color-3: #737373;
  --scalar-color-accent: #ff543a;
  --scalar-background-1: #0a0a0a;
  --scalar-background-2: #171717;
  --scalar-background-3: #262626;
  --scalar-background-accent: #ff543a1f;
  --scalar-border-color: rgba(255, 255, 255, 0.1);
}

.dark-mode .sidebar {
  --scalar-sidebar-background-1: #0a0a0a;
  --scalar-sidebar-item-hover-color: #ff543a;
  --scalar-sidebar-item-active-background: #ff543a1f;
  --scalar-sidebar-color-active: #ff543a;
  --scalar-sidebar-border-color: rgba(255, 255, 255, 0.1);
}
`;

export const apiDocsConfiguration = {
	title: "Zerobyte API Docs",
	pageTitle: "Zerobyte API Docs",
	theme: "default",
	darkMode: true,
	customCss: apiDocsCustomCss,
	hideClientButton: true,
	hideTestRequestButton: true,
	agent: { disabled: true },
} as const;

const apiDocsHandlerConfiguration = {
	...apiDocsConfiguration,
	url: "/api/v1/openapi.json",
};

export const apiDocsHandler = Scalar(apiDocsHandlerConfiguration);
