import "./setup-shared";

const { createTestDb } = await import("~/test/helpers/db");

await createTestDb();
