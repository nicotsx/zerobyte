import { setupServer } from "msw/node";

export { HttpResponse, http } from "msw";

export const server = setupServer();
