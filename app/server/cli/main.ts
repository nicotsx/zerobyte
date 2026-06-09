#!/usr/bin/env tsx

import { program } from "./index";

void program.parseAsync(process.argv).catch((err) => {
	console.error(err);
	process.exit(1);
});
