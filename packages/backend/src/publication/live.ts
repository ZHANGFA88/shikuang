// Live brief (AI 陪看要点卡): the single public read for cards generated worker-side by
// publication/live-brief.ts and stored per scope in settings ('live.brief'). The card a reader sees
// is the one generated for their viewing moment: the route reuses a card younger than
// LIVE_BRIEF_CACHE_TTL_MS, otherwise it enqueues a worker generation job and waits briefly for
// it (routes/site.ts). This module only reads; when no fresh card exists yet it returns the
// latest stored one with its original generatedAt — freshness is always honest, and nothing is
// ever synthesized at read time.
import { sql } from "../db.ts";
import type { LiveBrief, LiveBriefScope } from "./live-brief.ts";

export type { LiveBrief, LiveBriefScope };

/** Whether a generation job for this scope is still queued or running (lets the route stop
 * waiting as soon as the worker finished — e.g. when it found no new inputs). */
export async function liveBriefGenerationPending(scope: LiveBriefScope): Promise<boolean> {
  const rows = await sql<{ n: number }[]>
    `SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'live.brief' AND data->>'scope' = ${scope} AND state IN ('created', 'active', 'retry')`;
  return (rows[0]?.n ?? 0) > 0;
}

export async function loadLiveBriefCard(scope: LiveBriefScope): Promise<LiveBrief | null> {
  const [row] = await sql<{ value: { scopes?: Partial<Record<LiveBriefScope, { latest: LiveBrief | null }>>; latest?: LiveBrief | null } }[]>
    `SELECT value FROM settings WHERE key = 'live.brief'`;
  if (!row?.value) return null;
  if (row.value.scopes) return row.value.scopes[scope]?.latest ?? null;
  // Pre-scope storage shape: the single card was the "all" scope.
  return scope === "all" ? (row.value.latest ?? null) : null;
}
