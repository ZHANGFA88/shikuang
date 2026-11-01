// Retrieval over the 观潮 library (articles + analyses + recent daily reports).
// Dual path per the architecture ruling: vector recall when vectors exist
// (embeddings table has rows for EMBEDDING_MODEL and a key is configured),
// otherwise keyword recall (character bigrams). The switch is hardcoded;
// the sample stack exercises the keyword path end-to-end, the vector path is
// covered by synthetic-vector unit tests and marked 未实测 in the sample report.
import { sql } from "@aihot/backend/db";
import { lexicalSimilarity } from "@aihot/backend/events/relate";
import {
  EMBEDDING_MODEL,
  embeddingsAvailable,
  embedText,
} from "@aihot/backend/providers/embeddings";
import { RETRIEVAL_TOP_K, ASSISTANT_TOOLS, CITATION_SNIPPET_CHARS, type AssistantTool } from "@aihot/backend/publication/assistant";

export interface Passage {
  articleId: string;
  title: string;
  text: string;
  publishedAt: string | null;
  kind: "article" | "report";
  url: string; // site-internal citation link: /items/<id> or /daily/<key>
}

export type RetrievalStrategy = "vector" | "keyword";

const POOL_DAYS = 30;
const POOL_LIMIT = 500;

async function articlePool(): Promise<Passage[]> {
  // Mirror the item page's existence rule (publication/rules.ts hasItemPage):
  // only articles with a non-withdrawn publication from an editorial source
  // have a public /items/<id> page, so only those may be cited.
  const rows = await sql<{
    id: string; title: string; summary: string; body: string; url: string; published_at: string | null;
  }[]>`
    SELECT a.id,
           coalesce(p.title, an.title_zh, a.title) AS title,
           coalesce(p.summary, an.summary_zh, a.excerpt, '') AS summary,
           substring(coalesce(a.body_text, '') from 1 for 1500) AS body,
           a.url,
           coalesce(p.published_at, a.published_at)::text AS published_at
      FROM articles a
      JOIN publications p ON p.article_id = a.id AND p.visibility <> 'withdrawn'
      JOIN sources s ON s.id = p.source_id AND s.participation_mode = 'editorial'
      LEFT JOIN LATERAL (
        SELECT title_zh, summary_zh FROM analyses x
        WHERE x.article_id = a.id ORDER BY input_revision DESC, id DESC LIMIT 1
      ) an ON true
     WHERE a.discovered_at > now() - make_interval(days => ${POOL_DAYS})
     ORDER BY a.discovered_at DESC
     LIMIT ${POOL_LIMIT}`;
  return rows.map((r) => ({
    articleId: r.id,
    title: r.title,
    text: `${r.title}\n${r.summary}\n${r.body}`.slice(0, 2000),
    publishedAt: r.published_at,
    kind: "article" as const,
    url: `/items/${r.id}`,
  }));
}

async function reportPool(): Promise<Passage[]> {
  // Recent daily reports' full text (content jsonb shape: {sections:[{heading, body}]} or {text}).
  const rows = await sql<{ id: number; key: string; content: unknown; window_start: string }[]>`
    SELECT id, key, content, window_start::text FROM reports
     WHERE kind = 'daily' AND window_start > now() - make_interval(days => 7)
     ORDER BY window_start DESC LIMIT 7`;
  const out: Passage[] = [];
  for (const r of rows) {
    const text = extractReportText(r.content);
    if (text.trim().length > 50) {
      out.push({ articleId: `report-${r.id}`, title: `观潮日报 ${r.key}`, text: text.slice(0, 3000), publishedAt: r.window_start, kind: "report", url: `/daily/${r.key}` });
    }
  }
  return out;
}

export function extractReportText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const c = content as Record<string, unknown>;
  if (typeof c.text === "string") return c.text;
  if (Array.isArray(c.sections)) {
    return c.sections
      .map((s) => (s && typeof s === "object" ? `${(s as Record<string, unknown>).heading ?? ""}\n${(s as Record<string, unknown>).body ?? ""}` : ""))
      .join("\n");
  }
  return JSON.stringify(content).slice(0, 3000);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** The architecture-ruled switch: vectors exist AND a key is configured. */
export async function vectorPathAvailable(): Promise<boolean> {
  if (!embeddingsAvailable()) return false;
  const rows = await sql<{ n: string }[]>`SELECT count(*) AS n FROM embeddings WHERE model = ${EMBEDDING_MODEL}`;
  return Number(rows[0]!.n) > 0;
}

async function vectorRetrieve(question: string, pool: Passage[]): Promise<Passage[]> {
  const qv = await embedText(question, "assistant:question");
  const rows = await sql<{ ref_id: string; vector: unknown }[]>`
    SELECT ref_id, vector FROM embeddings WHERE kind = 'article' AND model = ${EMBEDDING_MODEL}
      AND ref_id = ANY(${pool.filter((p) => p.kind === "article").map((p) => p.articleId)})`;
  const byId = new Map<string, number[]>();
  for (const r of rows) {
    const v = Array.isArray(r.vector)
      ? (r.vector as number[])
      : typeof r.vector === "string"
        ? r.vector.replace(/[{}]/g, "").split(",").map(Number)
        : null;
    if (v && v.length > 0 && v.every(Number.isFinite)) byId.set(r.ref_id, v);
  }
  return pool
    .map((p) => ({ p, s: p.kind === "article" && byId.has(p.articleId) ? cosine(qv, byId.get(p.articleId)!) : -1 }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, RETRIEVAL_TOP_K)
    .map((x) => x.p);
}

function keywordRetrieve(question: string, pool: Passage[]): Passage[] {
  return pool
    .map((p) => {
      const titleScore = lexicalSimilarity(question, p.title);
      const bodyScore = lexicalSimilarity(question, p.text.slice(0, 600));
      return { p, s: titleScore * 2 + bodyScore };
    })
    .filter((x) => x.s > 0.05)
    .sort((a, b) => b.s - a.s)
    .slice(0, RETRIEVAL_TOP_K)
    .map((x) => x.p);
}

export async function retrieve(question: string): Promise<{ passages: Passage[]; strategy: RetrievalStrategy; poolSize: number; tools: AssistantTool[] }> {
  // §2.1 tool whitelist: only the hardcoded tools below may run; the pool is
  // the union of their results in whitelist order.
  const toolHandlers: Record<AssistantTool, () => Promise<Passage[]>> = {
    article_search: articlePool,
    report_search: reportPool,
  };
  const pool: Passage[] = [];
  const toolsUsed: AssistantTool[] = [];
  for (const tool of ASSISTANT_TOOLS) {
    pool.push(...(await toolHandlers[tool]()));
    toolsUsed.push(tool);
  }
  if (pool.length === 0) return { passages: [], strategy: "keyword", poolSize: 0, tools: toolsUsed };
  if (await vectorPathAvailable()) {
    return { passages: await vectorRetrieve(question, pool), strategy: "vector", poolSize: pool.length, tools: toolsUsed };
  }
  return { passages: keywordRetrieve(question, pool), strategy: "keyword", poolSize: pool.length, tools: toolsUsed };
}

/** §2.1: citation snippet — a display-side excerpt, never fed back to the model. */
export function makeSnippet(text: string, maxChars: number = CITATION_SNIPPET_CHARS): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= maxChars) return t;
  // avoid cutting a surrogate pair in half
  let cut = maxChars;
  const tail = t.charCodeAt(cut - 1);
  if (tail >= 0xd800 && tail <= 0xdbff) cut -= 1;
  return t.slice(0, cut).trimEnd() + "…";
}

/** Build the model context within the char budget; returns the text and the passages actually used. */
export function buildContext(passages: Passage[], maxChars: number): { text: string; used: Passage[] } {
  const used: Passage[] = [];
  const parts: string[] = [];
  let total = 0;
  for (let i = 0; i < passages.length; i++) {
    const p = passages[i]!;
    const chunk = `[资料${i + 1} id=${p.articleId}] ${p.title}${p.publishedAt ? `（${p.publishedAt.slice(0, 10)}）` : ""}\n${p.text.slice(0, 600)}`;
    if (total + chunk.length > maxChars) break;
    parts.push(chunk);
    used.push(p);
    total += chunk.length;
  }
  return { text: parts.join("\n\n"), used };
}
