// Heatmap public data contract (pure: no module imports, no I/O).
// The module socket (modules/heatmap) fetches constituents + quotes and calls
// buildBoardPayload(); the shape below is what the sample page consumes.
export type Board = "hs300" | "hsi" | "ndx" | "spx";

export interface HeatmapStockInput {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  marketCap: number; // 亿 of the board currency; NaN when unavailable
  turnoverPct?: number;
  peTtm?: number;
}

export interface HeatmapBlock extends HeatmapStockInput {
  direction: "up" | "down" | "flat";
  tier: 1 | 2 | 3; // 3 shade tiers by market-cap tertiles (largest = tier 1)
  weight: number;  // block area ∝ weight (= marketCap)
}

export interface HeatmapBoardPayload {
  board: Board;
  boardName: string;
  asOf: string;          // constituent list as-of date
  listSource: string;    // where the constituent list came from
  snapshotAt: string | null; // ISO time of this quote snapshot
  snapshotLabel: string; // "快照时间 HH:MM" in Beijing time
  currency: "CNY" | "HKD" | "USD";
  marketCapUnit: string; // unit of every stock's marketCap, e.g. 亿元人民币/亿港元/亿美元
  quoteSource: string;   // which quote source served this snapshot
  count: number;         // blocks rendered
  missing: number;       // constituents without a usable quote/market-cap
  missingSymbols: string[];
  stocks: HeatmapBlock[];
  unavailable: boolean;
  notice: {
    caliber: string; // data-caliber statement, shown in the page header
    legend: string;  // color/area legend
    listNote: string;// constituent-list as-of statement
  };
}

export const HEATMAP_BOARDS: Record<Board, { boardName: string; currency: "CNY" | "HKD" | "USD"; marketCapUnit: string }> = {
  hs300: { boardName: "沪深300", currency: "CNY", marketCapUnit: "亿元人民币" },
  hsi: { boardName: "恒生指数", currency: "HKD", marketCapUnit: "亿港元" },
  ndx: { boardName: "纳斯达克100", currency: "USD", marketCapUnit: "亿美元" },
  spx: { boardName: "标普500", currency: "USD", marketCapUnit: "亿美元" },
};

export function isBoard(value: string): value is Board {
  return value === "hs300" || value === "hsi" || value === "ndx" || value === "spx";
}

function beijingHHMM(d: Date): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(d);
}

/** Shade tiers by market-cap tertiles: tier 1 = largest third. */
export function assignTiers(sortedDesc: { marketCap: number }[]): (1 | 2 | 3)[] {
  const n = sortedDesc.length;
  return sortedDesc.map((_, i) => (i < n / 3 ? 1 : i < (2 * n) / 3 ? 2 : 3) as 1 | 2 | 3);
}

export function buildBoardPayload(args: {
  board: Board;
  asOf: string;
  listSource: string;
  inputs: HeatmapStockInput[];
  quoteSource: string;
  snapshotAt: Date;
}): HeatmapBoardPayload {
  const meta = HEATMAP_BOARDS[args.board];
  const usable = args.inputs.filter((s) => Number.isFinite(s.marketCap) && s.marketCap > 0 && Number.isFinite(s.changePct));
  const missingSymbols = args.inputs.filter((s) => !usable.includes(s)).map((s) => s.symbol);
  const sorted = [...usable].sort((a, b) => b.marketCap - a.marketCap);
  const tiers = assignTiers(sorted);
  const stocks: HeatmapBlock[] = sorted.map((s, i) => ({
    ...s,
    direction: s.changePct > 0 ? "up" : s.changePct < 0 ? "down" : "flat",
    tier: tiers[i]!,
    weight: s.marketCap,
  }));
  return {
    board: args.board,
    boardName: meta.boardName,
    asOf: args.asOf,
    listSource: args.listSource,
    snapshotAt: args.snapshotAt.toISOString(),
    snapshotLabel: `快照时间 ${beijingHHMM(args.snapshotAt)}`,
    currency: meta.currency,
    marketCapUnit: meta.marketCapUnit,
    quoteSource: args.quoteSource,
    count: stocks.length,
    missing: missingSymbols.length,
    missingSymbols,
    stocks,
    unavailable: false,
    notice: {
      caliber: `免费行情，${`快照时间 ${beijingHHMM(args.snapshotAt)}`}（北京时间），非实时逐笔`,
      legend: `红涨绿跌；块面积∝总市值；颜色深浅∝|涨跌幅|；市值单位：${meta.marketCapUnit}，不可跨板直接比较`,
      listNote: `成分截至 ${args.asOf}`,
    },
  };
}

export function unavailableBoard(board: Board): HeatmapBoardPayload {
  const meta = HEATMAP_BOARDS[board];
  return {
    board,
    boardName: meta.boardName,
    asOf: "",
    listSource: "",
    snapshotAt: null,
    snapshotLabel: "",
    currency: meta.currency,
    marketCapUnit: meta.marketCapUnit,
    quoteSource: "",
    count: 0,
    missing: 0,
    missingSymbols: [],
    stocks: [],
    unavailable: true,
    notice: {
      caliber: "行情源暂不可用",
      legend: `红涨绿跌；块面积∝总市值；颜色深浅∝|涨跌幅|；市值单位：${meta.marketCapUnit}，不可跨板直接比较`,
      listNote: "",
    },
  };
}
