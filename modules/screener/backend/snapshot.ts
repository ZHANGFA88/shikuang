/**
 * 选股器快照：每日收盘后按市场批量抓行情，写入 screener_snapshot。
 * 5日涨跌幅由快照序列推导：change5d = price_today / price_5snapshots_ago - 1
 * （首5个快照日为空，之后回填；避免数千次 kline 请求）。
 */
import { sql } from "../../../packages/backend/src/db.ts";
import { fetchQuotes } from "./quotes.ts";
import type { Market } from "./universe.ts";

const CURR = { a: "CNY", hk: "HKD", us: "USD" } as const;
const CAP_UNIT = { a: "亿元人民币", hk: "亿港元", us: "亿美元" } as const;

export async function takeSnapshot(market: Market): Promise<{
  snapshotDate: string;
  total: number;
  missing: number;
  quoteSource: string;
}> {
  const today = new Date().toISOString().slice(0, 10);
  const uni = await sql<{ symbol: string; name: string }[]>`
    SELECT symbol, name FROM screener_universe WHERE market=${market} AND active ORDER BY symbol`;
  const symbols = uni.map((r) => r.symbol);
  const { quotes, quoteSource } = await fetchQuotes(market, symbols);
  let n = 0, missing = 0;
  for (const u of uni) {
    const q = quotes.get(u.symbol);
    if (!q || q.price == null) {
      missing++;
      continue;
    }
    await sql`INSERT INTO screener_snapshot
        (market, symbol, snapshot_date, name, price, change_pct, pe_ttm, market_cap, market_cap_unit,
         turnover_pct, currency, quote_source, fetched_at)
      VALUES (${market}, ${u.symbol}, ${today}::date, ${q.name || u.name}, ${q.price}, ${q.changePct},
        ${q.peTtm}, ${q.marketCap}, ${CAP_UNIT[market]}, ${q.turnoverPct}, ${CURR[market]}, ${quoteSource}, now())
      ON CONFLICT (market, symbol, snapshot_date) DO UPDATE SET
        name=EXCLUDED.name, price=EXCLUDED.price, change_pct=EXCLUDED.change_pct,
        pe_ttm=EXCLUDED.pe_ttm, market_cap=EXCLUDED.market_cap, turnover_pct=EXCLUDED.turnover_pct,
        quote_source=EXCLUDED.quote_source, fetched_at=now()`;
    n++;
  }
  return { snapshotDate: today, total: n, missing, quoteSource };
}

export async function snapshotAll(): Promise<Record<string, { total: number; missing: number }>> {
  const out: Record<string, { total: number; missing: number }> = {};
  for (const m of ["a", "hk", "us"] as Market[]) out[m] = await takeSnapshot(m);
  return out;
}
