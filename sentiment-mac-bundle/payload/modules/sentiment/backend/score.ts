// Sentiment scoring (worker side only): one LLM judgment per public item, stored in the module's
// sentiment_scores table. Never runs in a reader's request path. The judgment prompt lives in
// prompts/sentiment.md; the model step is declared in server.ts (SENTIMENT_MODEL, purpose
// "sentiment_score") and paid through the receipts pipeline like every other model call.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { sql } from "@aihot/backend/db";
import { chatJson } from "@aihot/backend/providers/llm";
import { completeReceipt } from "@aihot/backend/providers/receipts";
import { modelFor } from "@aihot/backend/editorial/models";

const PROMPT_VERSION = "sentiment@2026-10-26";
const SYSTEM = readFileSync(new URL("../prompts/sentiment.md", import.meta.url), "utf8");

const Output = z.object({
  dir: z.enum(["POS", "NEG", "NEU"]),
  conf: z.number().min(0).max(1),
  grade: z.enum(["S", "A", "B", "C"]),
  reason: z.string().min(1).max(200),
  evidence: z.string().nullable(),
});

export type SentimentDir = "POS" | "NEG" | "NEU";
export type ImpactGrade = "S" | "A" | "B" | "C";

interface ScoreCandidate {
  id: string;
  title: string;
  titleZh: string | null;
  summary: string | null;
}

/** Score public items that have no sentiment row yet. Ordered oldest-first so a backfill fills the
 * window from the past forward; the schedule's small limit keeps each run cheap. */
export async function scoreItems(opts: { limit?: number; days?: number } = {}): Promise<{ scored: number; attempted: number }> {
  const limit = opts.limit ?? 20;
  const days = opts.days ?? 14;
  if (process.env.MODEL_CALLS_ENABLED !== "true") return { scored: 0, attempted: 0 };
  const candidates = await sql<ScoreCandidate[]>`
    SELECT a.id, a.title, a.title_zh AS "titleZh", p.summary
      FROM publications p JOIN articles a ON a.id = p.article_id
     WHERE p.visibility = 'public'
       AND coalesce(p.published_at, p.timeline_at) > now() - make_interval(days => ${days})
       AND NOT EXISTS (SELECT 1 FROM sentiment_scores s WHERE s.article_id = a.id)
     ORDER BY coalesce(p.published_at, p.timeline_at) ASC
     LIMIT ${limit}`;
  let scored = 0;
  for (const item of candidates) {
    const model = await modelFor("sentiment");
    const res = await chatJson({
      model,
      purpose: "sentiment_score",
      subject: `sentiment:${item.id}`,
      promptVersion: PROMPT_VERSION,
      system: SYSTEM,
      user: JSON.stringify({ title: item.title, titleZh: item.titleZh, summary: (item.summary ?? "").slice(0, 400) }),
      schema: Output,
      temperature: 0.2,
      maxTokens: 600,
      timeoutMs: 60_000,
    });
    if (res.receiptId !== null) {
      await sql.begin(async (tx) => {
        await completeReceipt(tx, res.receiptId);
      });
    }
    // Spec §1: never claim full certainty; round to two decimals and cap at 0.99.
    const conf = Math.min(0.99, Math.max(0, Math.round(res.data.conf * 100) / 100));
    const reason = res.data.reason.trim().slice(0, 120);
    await sql`INSERT INTO sentiment_scores (article_id, sentiment_dir, sentiment_conf, impact_grade, impact_reason, sentiment_evidence, model, prompt_version)
              VALUES (${item.id}, ${res.data.dir}, ${conf}, ${res.data.grade}, ${reason}, ${res.data.evidence}, ${model}, ${PROMPT_VERSION})
              ON CONFLICT (article_id) DO NOTHING`;
    scored += 1;
  }
  return { scored, attempted: candidates.length };
}

/** The module schedule's run: only unscored recent public items, small batch. */
export async function scoreRecent(): Promise<{ scored: number }> {
  return scoreItems({ limit: 20, days: 14 });
}
