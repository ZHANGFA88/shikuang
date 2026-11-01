/**
 * 选股器 universe（候选池）：
 * - A股：新浪 hs_a / sz_a 动态 node（每日刷新，含北交所 bj 前缀）
 * - 港股：静态主板名单 data/hk-mainboard.json（stockanalysis 全市场名单；每季度与 HKEX 口径核对）
 * - 美股：纳指100 + 标普500 静态名单（复用 heatmap data；每季度重取）
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "../../../packages/backend/src/db.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type Market = "a" | "hk" | "us";

async function fetchText(url: string, referer?: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, ...(referer ? { Referer: referer } : {}) },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return new TextDecoder("gbk").decode(buf);
  } finally {
    clearTimeout(t);
  }
}

interface Constituent {
  symbol: string;
  name: string;
}

/** 新浪 A股全市场 node（hs_a 沪 + sz_a 深，含 bj 北交所）。page=100 分页。 */
async function sinaAStocks(): Promise<Constituent[]> {
  const out: Constituent[] = [];
  for (const node of ["hs_a", "sz_a"]) {
    for (let page = 1; page <= 60; page++) {
      const url =
        `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData` +
        `?page=${page}&num=100&sort=symbol&asc=1&node=${node}&symbol=&_s_r_a=init`;
      const text = await fetchText(url, "https://finance.sina.com.cn");
      const rows = JSON.parse(text);
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const r of rows) {
        const code: string = r.code ?? "";
        if (!code) continue;
        out.push({ symbol: code.replace(/^(sh|sz|bj)/, ""), name: r.name ?? "" });
      }
      if (rows.length < 100) break;
    }
  }
  return out;
}

async function staticList(file: string): Promise<{ asOf: string; source: string; list: Constituent[] }> {
  const raw = JSON.parse(await readFile(join(HERE, "..", "data", file), "utf8"));
  return { asOf: raw.asOf, source: raw.source, list: raw.constituents };
}

export async function loadUniverse(
  market: Market,
): Promise<{ asOf: string; source: string; list: Constituent[] }> {
  if (market === "a") {
    const list = await sinaAStocks();
    return { asOf: new Date().toISOString().slice(0, 10), source: "sina-node(hs_a+sz_a)", list };
  }
  if (market === "hk") return staticList("hk-mainboard.json");
  // us: 纳指100 + 标普500（复用 heatmap 静态名单），去重
  const heatmapData = join(HERE, "..", "..", "heatmap", "data");
  const seen = new Map<string, string>();
  let asOf = "", sources: string[] = [];
  for (const f of ["ndx.json", "spx.json"]) {
    const raw = JSON.parse(await readFile(join(heatmapData, f), "utf8"));
    asOf = raw.asOf;
    sources.push(raw.source);
    for (const c of raw.constituents) if (!seen.has(c.symbol)) seen.set(c.symbol, c.name);
  }
  return {
    asOf,
    source: [...new Set(sources)].join("；"),
    list: [...seen].map(([symbol, name]) => ({ symbol, name })),
  };
}

/** worker 定时任务：刷新三市场 universe（A股动态重取，hk/us 静态文件入库）。 */
export async function refreshUniverse(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const market of ["a", "hk", "us"] as Market[]) {
    const runAt = new Date();
    const { asOf, source, list } = await loadUniverse(market);
    let n = 0;
    for (const c of list) {
      await sql`INSERT INTO screener_universe (market, symbol, name, list_source, as_of, active, updated_at)
        VALUES (${market}, ${c.symbol}, ${c.name}, ${source}, ${asOf}::date, true, ${runAt})
        ON CONFLICT (market, symbol) DO UPDATE SET name=EXCLUDED.name, list_source=EXCLUDED.list_source,
          as_of=EXCLUDED.as_of, active=true, updated_at=EXCLUDED.updated_at`;
      n++;
    }
    // 本轮未出现的符号标记 inactive（退市/剔除），进校验日志口径
    await sql`UPDATE screener_universe SET active=false, updated_at=${runAt}
      WHERE market=${market} AND updated_at < ${runAt} AND active`;
    counts[market] = n;
  }
  return counts;
}
