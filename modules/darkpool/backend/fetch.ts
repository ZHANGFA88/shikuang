/**
 * FINRA ATS 周度数据抓取：官方 Query API（keyless）。
 * 按 (symbol, weekStart) 聚合 FIRM 明细行为周度总量；保留最新周分 ATS 明细。
 * 沙箱注记：沙箱出口该 API 只回 2026 年前陈旧分区且忽略分区参数——
 * 此处只验代码与契约，不称可用样板；数据新鲜度待真出口（Mac 清单项）确认。
 */
import { sql } from "../../../packages/backend/src/db.ts";

const API = "https://api.finra.org/data/group/otcmarket/name/weeklySummary";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

interface FinraRow {
  issueSymbolIdentifier: string | null;
  issueName: string | null;
  MPID: string | null;
  marketParticipantName: string | null;
  tierIdentifier: string | null;
  summaryStartDate: string | null;
  totalWeeklyTradeCount: number | null;
  totalWeeklyShareQuantity: number | null;
  totalNotionalSum: number | null;
  summaryTypeCode: string | null;
  weekStartDate: string | null;
  initialPublishedDate: string | null;
}

export interface SymbolWeek {
  symbol: string;
  name: string;
  tier: string;
  weekStart: string;
  publishedAt: string;
  shareQty: number;
  tradeCount: number;
  notional: number | null;
  ats: { mpid: string; name: string; shareQty: number }[];
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 纯函数：FIRM 明细行 → 按 (symbol, week) 聚合。单测覆盖。 */
export function aggregateRows(rows: FinraRow[]): SymbolWeek[] {
  const byKey = new Map<string, SymbolWeek & { _ats: Map<string, { mpid: string; name: string; shareQty: number }> }>();
  for (const r of rows) {
    if (r.summaryTypeCode !== "ATS_W_SMBL_FIRM") continue;
    const symbol = (r.issueSymbolIdentifier ?? "").trim();
    const weekStart = (r.weekStartDate ?? "").slice(0, 10);
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) continue;
    const key = `${symbol}|${weekStart}`;
    let e = byKey.get(key);
    if (!e) {
      e = {
        symbol, name: r.issueName ?? symbol, tier: r.tierIdentifier ?? "",
        weekStart, publishedAt: (r.initialPublishedDate ?? "").slice(0, 10),
        shareQty: 0, tradeCount: 0, notional: 0, ats: [],
        _ats: new Map(),
      };
      byKey.set(key, e);
    }
    const sq = num(r.totalWeeklyShareQuantity) ?? 0;
    const tc = num(r.totalWeeklyTradeCount) ?? 0;
    e.shareQty += sq;
    e.tradeCount += tc;
    const notional = num(r.totalNotionalSum);
    if (notional != null) e.notional = (e.notional ?? 0) + notional;
    const mpid = (r.MPID ?? "").trim();
    if (mpid && sq > 0) {
      const prev = e._ats.get(mpid);
      if (prev) prev.shareQty += sq;
      else e._ats.set(mpid, { mpid, name: r.marketParticipantName ?? mpid, shareQty: sq });
    }
    if (!e.publishedAt && r.initialPublishedDate) e.publishedAt = r.initialPublishedDate.slice(0, 10);
  }
  return [...byKey.values()].map((e) => ({
    symbol: e.symbol, name: e.name, tier: e.tier, weekStart: e.weekStart,
    publishedAt: e.publishedAt, shareQty: e.shareQty, tradeCount: e.tradeCount,
    notional: e.notional || null,
    ats: [...e._ats.values()].sort((a, b) => b.shareQty - a.shareQty).slice(0, 10),
  }));
}

async function fetchPartition(): Promise<FinraRow[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120_000);
  try {
    // 目标：最新一周分区。按文档 weekStartDate 为必填分区参数；
    // 沙箱侧该参数被忽略（只回陈旧分区）——见模块头注记。
    const monday = lastMonday();
    const url = `${API}?weekStartDate=${monday}&limit=200000`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`finra http ${res.status}`);
    const j: unknown = await res.json();
    return (Array.isArray(j) ? j : (j as { data?: FinraRow[] }).data ?? []) as FinraRow[];
  } finally {
    clearTimeout(t);
  }
}

function lastMonday(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

/** worker 周度任务：拉取 → 聚合 → 入库。返回入库周数与 symbol 数。 */
export async function fetchWeekly(): Promise<{ weeks: string[]; symbols: number; rows: number }> {
  const rows = await fetchPartition();
  const weeks = aggregateRows(rows);
  const fetchedAt = new Date();
  let n = 0;
  for (const w of weeks) {
    if (!w.publishedAt) continue; // 延迟三要素缺发布日期：不入库
    await sql`INSERT INTO darkpool_weekly
        (symbol, week_start, tier, name, share_qty, trade_count, notional, published_at, fetched_at)
      VALUES (${w.symbol}, ${w.weekStart}::date, ${w.tier}, ${w.name}, ${w.shareQty}, ${w.tradeCount},
        ${w.notional}, ${w.publishedAt}::date, ${fetchedAt})
      ON CONFLICT (symbol, week_start) DO UPDATE SET
        tier=EXCLUDED.tier, name=EXCLUDED.name, share_qty=EXCLUDED.share_qty,
        trade_count=EXCLUDED.trade_count, notional=EXCLUDED.notional,
        published_at=EXCLUDED.published_at, fetched_at=EXCLUDED.fetched_at`;
    for (const a of w.ats) {
      await sql`INSERT INTO darkpool_ats_breakdown (symbol, week_start, mpid, ats_name, share_qty)
        VALUES (${w.symbol}, ${w.weekStart}::date, ${a.mpid}, ${a.name}, ${a.shareQty})
        ON CONFLICT (symbol, week_start, mpid) DO UPDATE SET ats_name=EXCLUDED.ats_name, share_qty=EXCLUDED.share_qty`;
    }
    n++;
  }
  return { weeks: [...new Set(weeks.map((w) => w.weekStart))].sort(), symbols: n, rows: rows.length };
}
