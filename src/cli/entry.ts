#!/usr/bin/env node
import { main } from "./main.js";

// The built `dist/cli.js`. Kept apart from main.ts so importing the CLI never starts it.
await main();
