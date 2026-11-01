// Board orchestration for the heatmap sample endpoint.
// 5-minute server-side cache (intraday); on total source failure the board is
// marked unavailable and NO stale snapshot is served.
import {
  buildBoardPayload,
  unavailableBoard,
  type Board,
  type HeatmapBoardPayload,
  type HeatmapStockInput,
} from "@aihot/backend/publication/heatmap";
import { getConstituents } from "./constituents.ts";
import {
  sinaBatch,
  sinaHs300,
  tencentBatch,
  toSinaCode,
  toTencentCode,
  sourceHealth,
  type Quote,
} from "./quotes.ts";

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<Board, { at: number; payload: HeatmapBoardPayload }>();

export function heatmapCacheState(): Record<string, { ageSec: number; ttlSec: number }> {
  const now = Date.now();
  return Object.fromEntries(
    [...cache.entries()].map(([b, c]) => [b, { ageSec: Math.round((now - c.at) / 1000), ttlSec: CACHE_TTL_MS / 1000 }]),
  );
}
export { sourceHealth };

/** hs300: sina node API is the primary (constituents + mktcap + change in one call). */
async function hs300Inputs(): Promise<{ inputs: HeatmapStockInput[]; source: string; asOf: string; listSource: string }> {
  const { asOf, source, list } = await getConstituents("hs300");
  try {
    const rows = await sinaHs300();
    const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
    const inputs: HeatmapStockInput[] = list.map((c) => {
      const r = bySymbol.get(c.symbol);
      return {
        symbol: c.symbol,
        name: r?.name ?? c.name,
        price: Number(r?.trade ?? NaN),
        changePct: Number(r?.changepercent ?? NaN),
        marketCap: Number.isFinite(Number(r?.mktcap)) ? Number(r!.mktcap) / 10000 : NaN, // 万元 -> 亿
        turnoverPct: Number(r?.turnoverratio ?? NaN),
        peTtm: Number(r?.per ?? NaN),
      };
    });
    return { inputs, source: "sina", asOf, listSource: source };
  } catch (e) {
    console.warn(`[heatmap] hs300 sina node failed, falling back to tencent: ${(e as Error).message}`);
    const codes = list.map((c) => toTencentCode("hs300", c.symbol));
    const { quotes } = await (async () => ({ quotes: await tencentBatch(codes) }))();
    const byCode = new Map(quotes.map((q) => [q.code, q]));
    const inputs: HeatmapStockInput[] = list.map((c) => {
      const q = byCode.get(toTencentCode("hs300", c.symbol));
      return toInput(c.symbol, c.name, q);
    });
    return { inputs, source: "tencent", asOf, listSource: source };
  }
}

function toInput(symbol: string, name: string, q: Quote | undefined): HeatmapStockInput {
  return {
    symbol,
    name: q?.name ?? name,
    price: q?.price ?? NaN,
    changePct: q?.changePct ?? NaN,
    marketCap: q?.marketCap ?? NaN,
    turnoverPct: q?.turnoverPct,
    peTtm: q?.peTtm,
  };
}

/** hsi/ndx/spx: tencent batch primary (has market cap), sina batch price-only fallback. */
async function staticBoardInputs(board: Board): Promise<{ inputs: HeatmapStockInput[]; source: string; asOf: string; listSource: string }> {
  const { asOf, source, list } = await getConstituents(board);
  let quotes: Quote[] | null = null;
  let src = "";
  try {
    quotes = await tencentBatch(list.map((c) => toTencentCode(board, c.symbol)));
    src = "tencent";
  } catch (e) {
    console.warn(`[heatmap] ${board} tencent failed, trying sina: ${(e as Error).message}`);
    quotes = await sinaBatch(list.map((c) => toSinaCode(board, c.symbol)));
    src = "sina";
  }
  const byCode = new Map(quotes.map((q) => [q.code, q]));
  const codeOf = src === "tencent" ? toTencentCode : toSinaCode;
  const inputs = list.map((c) => toInput(c.symbol, c.name, byCode.get(codeOf(board, c.symbol))));
  return { inputs, source: src, asOf, listSource: source };
}

export async function serveBoard(board: Board): Promise<HeatmapBoardPayload> {
  const hit = cache.get(board);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload;
  try {
    const { inputs, source, asOf, listSource } =
      board === "hs300" ? await hs300Inputs() : await staticBoardInputs(board);
    const payload = buildBoardPayload({ board, asOf, listSource, inputs, quoteSource: source, snapshotAt: new Date() });
    if (payload.count === 0) {
      console.warn(`[heatmap] ${board}: no usable blocks, marking unavailable`);
      const u = unavailableBoard(board);
      cache.delete(board);
      return u;
    }
    cache.set(board, { at: Date.now(), payload });
    return payload;
  } catch (e) {
    // Total chain failure: never serve a stale snapshot as live.
    console.error(`[heatmap] ${board}: all quote sources failed: ${(e as Error).message}`);
    cache.delete(board);
    return unavailableBoard(board);
  }
}
