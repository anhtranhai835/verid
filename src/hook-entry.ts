import { main } from "./hook.js";

// The built `dist/hook.js`. Kept apart from hook.ts so importing the hook never starts it.
await main();
