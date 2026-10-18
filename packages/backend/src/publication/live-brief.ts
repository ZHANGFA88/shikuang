// AI 陪看要点卡 (live brief): conclusions follow the viewing moment. When a reader opens the
// live page (or picks a channel), the endpoint asks for a card for that scope; generation runs
// here — worker side only, through the receipts pipeline — never in the reader's request path.
// A card younger than CACHE_TTL_MS is reused instead of paying for a new one, and every card
// carries its real generatedAt. The 30-minute schedule only warms the cache / backstops an
// empty page; it is no longer the source of the card a reader sees. When nothing new arrived
// since the last card (watermark), generation is skipped and the previous card keeps being
// served with its honest timestamp rather than inventing a fresh one.
import { z } from "zod";
import { beijingTime } from "@aihot/contracts/time";
import { sql } from "../db.ts";
import { chatJson } from "../providers/llm.ts";
import { completeReceipt } from "../providers/receipts.ts";
import { modelFor } from "../editorial/models.ts";
import { promptFromText } from "../editorial/prompts.ts";

/** Public channel keys (endpoint ?channel=) → source id + display label. */
export const LIVE_CHANNELS = {
  bloomberg: { sourceId: "push-yt-bloomberg", label: "Bloomberg TV" },
  yahoo: { sourceId: "push-yt-yahoo", label: "Yahoo Finance" },
  dw: { sourceId: "push-yt-dw", label: "DW News" },
} as const;
export type LiveChannelKey = keyof typeof LIVE_CHANNELS;
/** Scope = "all" (every channel) or one channel key. Cards are stored per scope. */
export type LiveBriefScope = "all" | LiveChannelKey;
export const LIVE_CHANNEL_SOURCE_IDS = Object.values(LIVE_CHANNELS).map((c) => c.sourceId);
/** A card younger than this is reused for on-demand requests instead of regenerating. */
export const LIVE_BRIEF_CACHE_TTL_MS = 5 * 60 * 1000;

const SETTINGS_KEY = "live.brief";
const PURPOSE = "live_brief";
const PROMPT_VERSION = "live-brief@2026-10-17.2";
const CHANNEL_WINDOW_HOURS = 24;
const SITE_WINDOW_HOURS = 2;
const SITE_WINDOW_FALLBACK_HOURS = 6;

export interface LiveBriefItem {
  id: string;
  title: string;
}

export interface LiveBrief {
  generatedAt: string;
  windowLabel: string;
  briefText: string;
  relatedItems: LiveBriefItem[];
  symbols: string[];
  scope: LiveBriefScope;
}

interface StoredScope {
  latest: LiveBrief | null;
  watermark: string | null; // newest input published_at the latest card was built from
  runs: LiveBrief[];
}

interface StoredLiveBrief {
  scopes: Partial<Record<LiveBriefScope, StoredScope>>;
}

interface InputItem {
  id: string;
  title: string;
  titleZh: string | null;
  excerpt: string | null;
  publishedAt: string;
  channel: boolean;
}

const Output = z.object({
  briefText: z.string().min(40).max(600),
  relatedItemIds: z.array(z.string()).max(8),
});

const SYSTEM = promptFromText(
  "live-brief",
  [
    "你是一名财经直播陪看编辑。根据给定的电视新闻频道最新视频标题与本站同期新闻，写一段中文要点（120-220 字）：",
    "先说过去一小时直播频道在讲什么重点，再说本站哪些报道与之印证或补充。",
    "只能使用给定材料里的事实，不许编造数字、引语或材料之外的事件；材料不足以判断时如实说动态有限。",
    '只返回 JSON：{"briefText": "...", "relatedItemIds": ["与要点最相关的本站条目 id，3-6 个"]}',
    "relatedItemIds 只能从给定条目的 id 中选，不得新造。",
  ].join(""),
);

/** SPCX keyword rules as ruled in DESIGN-TICKER-LIBRARY §3 (the only ruled watchlist口径 so far). */
export function matchSymbols(text: string): string[] {
  const strong = /SpaceX|SPCX|Starlink|星链|Space Exploration Technologies/i;
  if (strong.test(text) && !/\bSPAC\b/.test(text.replace(/SPCX/gi, ""))) return ["SPCX"];
  const weak = /马斯克|Elon Musk/i;
  const context = /火箭|发射|卫星|星舰|Starship|猎鹰|Falcon|NASA/;
  if (weak.test(text) && context.test(text)) return ["SPCX"];
  return [];
}

const emptyScope = (): StoredScope => ({ latest: null, watermark: null, runs: [] });

export async function loadStoredLiveBrief(): Promise<StoredLiveBrief> {
  const [row] = await sql<{ value: StoredLiveBrief & { latest?: LiveBrief | null; watermark?: string | null; runs?: LiveBrief[] } }[]>
    `SELECT value FROM settings WHERE key = ${SETTINGS_KEY}`;
  if (!row?.value) return { scopes: {} };
  // Pre-scope storage shape (single card): adopt it as the "all" scope.
  if (!row.value.scopes && row.value.latest !== undefined) {
    return { scopes: { all: { latest: row.value.latest ?? null, watermark: row.value.watermark ?? null, runs: row.value.runs ?? [] } } };
  }
  return { scopes: row.value.scopes ?? {} };
}

export async function loadLiveBrief(scope: LiveBriefScope): Promise<LiveBrief | null> {
  const stored = await loadStoredLiveBrief();
  return stored.scopes[scope]?.latest ?? null;
}

async function gatherInputs(scope: LiveBriefScope): Promise<InputItem[]> {
  const channelIds = scope === "all" ? LIVE_CHANNEL_SOURCE_IDS : [LIVE_CHANNELS[scope].sourceId];
  const channel = await sql<InputItem[]>
    `SELECT id, title, title_zh AS "titleZh", excerpt, published_at AS "publishedAt", true AS channel
       FROM articles
      WHERE source_id = ANY(${channelIds}) AND published_at > now() - make_interval(hours => ${CHANNEL_WINDOW_HOURS})
      ORDER BY published_at DESC LIMIT 12`;
  let site = await sql<InputItem[]>
    `SELECT id, title, title_zh AS "titleZh", excerpt, published_at AS "publishedAt", false AS channel
       FROM articles
      WHERE source_id <> ALL(${LIVE_CHANNEL_SOURCE_IDS}) AND published_at > now() - make_interval(hours => ${SITE_WINDOW_HOURS})
      ORDER BY published_at DESC LIMIT 20`;
  if (site.length < 5) {
    site = await sql<InputItem[]>
      `SELECT id, title, title_zh AS "titleZh", excerpt, published_at AS "publishedAt", false AS channel
         FROM articles
        WHERE source_id <> ALL(${LIVE_CHANNEL_SOURCE_IDS}) AND published_at > now() - make_interval(hours => ${SITE_WINDOW_FALLBACK_HOURS})
        ORDER BY published_at DESC LIMIT 20`;
  }
  // The driver hands back Date objects; the stored watermark is an ISO string — normalize so the
  // no-new-inputs comparison is string-to-string.
  return [...channel, ...site].map((i) => ({ ...i, publishedAt: new Date(i.publishedAt).toISOString() }));
}

export async function generateLiveBrief(scope: LiveBriefScope = "all"): Promise<{ generated: boolean; reason?: string }> {
  if (process.env.MODEL_CALLS_ENABLED !== "true") return { generated: false, reason: "model calls disabled" };
  const stored = await loadStoredLiveBrief();
  const scopeStored = stored.scopes[scope] ?? emptyScope();
  const inputs = await gatherInputs(scope);
  const channelItems = inputs.filter((i) => i.channel);
  if (!channelItems.length) return { generated: false, reason: "no channel items" };
  const watermark = inputs.reduce((max, i) => (i.publishedAt > max ? i.publishedAt : max), inputs[0]!.publishedAt);
  if (scopeStored.watermark && watermark <= scopeStored.watermark) return { generated: false, reason: "no new inputs" };

  const focus = scope === "all" ? "全部直播频道" : LIVE_CHANNELS[scope].label;
  const user = {
    focus,
    channels: channelItems.map((i) => ({ id: i.id, title: i.titleZh ?? i.title, publishedAt: i.publishedAt })),
    site: inputs.filter((i) => !i.channel).map((i) => ({ id: i.id, title: i.titleZh ?? i.title, summary: (i.excerpt ?? "").slice(0, 160), publishedAt: i.publishedAt })),
  };
  const model = await modelFor("digest");
  const res = await chatJson({
    model,
    purpose: PURPOSE,
    subject: `live-brief:${scope}:${watermark}`,
    promptVersion: PROMPT_VERSION,
    system: SYSTEM,
    user: JSON.stringify(user),
    schema: Output,
    temperature: 0.3,
    maxTokens: 1200,
    timeoutMs: 120_000,
  });
  if (res.receiptId !== null) {
    await sql.begin(async (tx) => {
      await completeReceipt(tx, res.receiptId);
    });
  }

  const byId = new Map(inputs.map((i) => [i.id, i]));
  const relatedItems: LiveBriefItem[] = [];
  for (const id of res.data.relatedItemIds) {
    const item = byId.get(id);
    if (item) relatedItems.push({ id: item.id, title: item.titleZh ?? item.title });
  }
  if (!relatedItems.length) {
    for (const item of channelItems.slice(0, 3)) relatedItems.push({ id: item.id, title: item.titleZh ?? item.title });
  }
  const symbols = [...new Set(inputs.flatMap((i) => matchSymbols(`${i.title} ${i.titleZh ?? ""} ${i.excerpt ?? ""}`)))];
  const now = new Date();
  const brief: LiveBrief = {
    generatedAt: now.toISOString(),
    windowLabel: scope === "all"
      ? `截至 ${beijingTime(now)} 的频道动态与站内报道`
      : `${LIVE_CHANNELS[scope].label} · 截至 ${beijingTime(now)} 的频道动态与站内报道`,
    briefText: res.data.briefText,
    relatedItems,
    symbols,
    scope,
  };
  stored.scopes[scope] = { latest: brief, watermark, runs: [brief, ...scopeStored.runs].slice(0, 10) };
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${SETTINGS_KEY}, ${sql.json(stored as never)}, 'live-brief')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  return { generated: true };
}

/** The 30-minute schedule's job now: warm every scope so a page open rarely waits. Each scope is
 * watermark-gated, so a quiet half hour costs no model call at all. */
export async function warmLiveBriefs(): Promise<{ generated: number }> {
  let generated = 0;
  for (const scope of ["all", "bloomberg", "yahoo", "dw"] as LiveBriefScope[]) {
    if ((await generateLiveBrief(scope)).generated) generated += 1;
  }
  return { generated };
}
