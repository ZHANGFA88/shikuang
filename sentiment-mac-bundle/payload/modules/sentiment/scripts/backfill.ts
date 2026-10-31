// Sample-data backfill (worker script, NOT a published migration): score real public items in
// the window, oldest-first. Usage: node --env-file=.env modules/sentiment/scripts/backfill.ts
// [--days 30] [--limit 200]. Installs the module so modelFor("sentiment") resolves its step.
import { installModules } from "@aihot/backend/modules";
import { closeDb } from "@aihot/backend/db";
import { sentimentServer } from "../server.ts";
import { scoreItems } from "../backend/score.ts";

installModules([sentimentServer]);
const args = process.argv.slice(2);
const get = (flag: string, fallback: number): number => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const days = get("--days", 30);
const limit = get("--limit", 200);
const started = Date.now();
const result = await scoreItems({ days, limit });
console.log(JSON.stringify({ days, limit, ...result, elapsedMs: Date.now() - started }));
if (result.quotaExhausted) {
  // Degraded, NOT a failure: the export step still runs (yielding a 0-row file
  // when nothing was scored) and run.sh continues. This WARNING lands in the
  // Mac backfill report file via the run.sh tee. Rerun after the quota resets.
  console.log(
    `WARNING: model 429/quota exhausted after ${result.scored}/${result.attempted} items; ` +
    `already-scored rows are kept, export proceeds. Rerun this backfill after the quota resets.`,
  );
}
await closeDb();
