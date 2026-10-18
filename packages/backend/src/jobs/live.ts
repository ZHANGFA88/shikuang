// Live brief generation jobs: the on-demand path (a reader opened the live page) enqueues here;
// the model call itself always runs in this worker, never in the API process.
import type { PgBoss } from "pg-boss";
import { generateLiveBrief, type LiveBriefScope } from "../publication/live-brief.ts";
import { QUEUES, work } from "./queue.ts";

const SCOPES: LiveBriefScope[] = ["all", "bloomberg", "yahoo", "dw"];

export async function registerLiveJobs(boss: PgBoss) {
  await work(boss, QUEUES.liveBrief, { localConcurrency: 1, pollingIntervalSeconds: 1 }, async ({ scope }) => {
    const valid = (SCOPES as string[]).includes(scope) ? (scope as LiveBriefScope) : "all";
    return generateLiveBrief(valid);
  });
}
