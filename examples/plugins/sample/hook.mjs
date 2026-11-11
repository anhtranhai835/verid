import { appendFileSync } from "node:fs";
import { join } from "node:path";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const event = JSON.parse(input);
appendFileSync(join(process.env.VERID_PLUGIN_DATA, "events.jsonl"), JSON.stringify(event) + "\n");
