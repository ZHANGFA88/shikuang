// Export scored sentiment rows for hand-back to the cloud sample stack (NOT a production route).
// Usage: node modules/sentiment/scripts/export.ts [--days 30] [--out sentiment-export-<date>.json]
// Writes one JSON file: { generatedAt, windowDays, model, promptVersion, count, items: [...] }.
// The file is the only artifact the Mac side returns; the cloud side re-imports it verbatim.
import { writeFileSync } from "node:fs";
import { sql, closeDb } from "@aihot/backend/db";

const args = process.argv.slice(2);
const get = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const days = Number(get("--days", "30"));
const beijingToday = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const out = get("--out", `sentiment-export-${beijingToday}.json`);

const rows = await sql<{
  articleId: string;
  date: string;
  title: string;
  titleZh: string | null;
  dir: string;
  conf: string;
  grade: string;
  reason: string;
  evidence: string | null;
  model: string;
  promptVersion: string;
}[]>`
  SELECT a.id AS "articleId",
         to_char(timezone('Asia/Shanghai', coalesce(p.published_at, p.timeline_at)), 'YYYY-MM-DD') AS date,
         a.title, a.title_zh AS "titleZh",
         s.sentiment_dir AS dir, s.sentiment_conf::text AS conf, s.impact_grade AS grade,
         s.impact_reason AS reason, s.sentiment_evidence AS evidence,
         s.model, s.prompt_version AS "promptVersion"
    FROM sentiment_scores s
    JOIN articles a ON a.id = s.article_id
    JOIN publications p ON p.article_id = a.id AND p.visibility = 'public'
   WHERE coalesce(p.published_at, p.timeline_at) > now() - make_interval(days => ${days})
   ORDER BY coalesce(p.published_at, p.timeline_at) ASC, a.id ASC`;

const payload = {
  generatedAt: new Date().toISOString(),
  windowDays: days,
  count: rows.length,
  items: rows.map((r) => ({
    article_id: r.articleId,
    date: r.date,
    title: r.title,
    title_zh: r.titleZh,
    sentiment_dir: r.dir,
    sentiment_conf: Number(r.conf),
    impact_grade: r.grade,
    impact_reason: r.reason,
    sentiment_evidence: r.evidence,
    model: r.model,
    prompt_version: r.promptVersion,
  })),
};
writeFileSync(out, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ out, count: payload.count }));
await closeDb();
