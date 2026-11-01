/**
 * 选股器公开契约（publication 层）：纯函数，把 DB 快照行拼成前端 payload。
 * 口径文案逐字固定，生产前由架构逐字审。
 */
export type ScreenMarket = "a" | "hk" | "us";

export const SCREENER_MARKETS: Record<ScreenMarket, { name: string; currency: string; marketCapUnit: string }> = {
  a: { name: "A股全市场", currency: "CNY", marketCapUnit: "亿元人民币" },
  hk: { name: "港股主板", currency: "HKD", marketCapUnit: "亿港元" },
  us: { name: "美股（纳指100+标普500）", currency: "USD", marketCapUnit: "亿美元" },
};

export const SCREENER_CALIBER = "基于免费行情/基本面数据，非投资建议";
export const screenerLegend = (marketCapUnit: string) =>
  `市值单位：${marketCapUnit}，不可跨市场直接比较；5日涨跌幅由每日快照序列推导，首5个快照日为空`;

export interface ScreenRowOut {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
  change5d: number | null;
  peTtm: number | null;
  marketCap: number | null;
  turnoverPct: number | null;
}

export interface ScreenerPayload {
  market: ScreenMarket;
  marketName: string;
  snapshotDate: string;
  snapshotAt: string; // 北京时间 HH:MM
  stale: boolean;
  currency: string;
  marketCapUnit: string;
  quoteSource: string;
  universe: number;
  total: number;
  page: number;
  pageSize: number;
  rows: ScreenRowOut[];
  notice: { caliber: string; legend: string; listNote: string };
}

export function beijingHHMM(d = new Date()): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

export function buildScreenerPayload(args: {
  market: ScreenMarket;
  snapshotDate: string;
  universe: number;
  total: number;
  page: number;
  pageSize: number;
  rows: ScreenRowOut[];
  quoteSource: string;
  listNote: string;
}): ScreenerPayload {
  const meta = SCREENER_MARKETS[args.market];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  return {
    market: args.market,
    marketName: meta.name,
    snapshotDate: args.snapshotDate,
    snapshotAt: beijingHHMM(),
    stale: args.snapshotDate !== today,
    currency: meta.currency,
    marketCapUnit: meta.marketCapUnit,
    quoteSource: args.quoteSource,
    universe: args.universe,
    total: args.total,
    page: args.page,
    pageSize: args.pageSize,
    rows: args.rows,
    notice: { caliber: SCREENER_CALIBER, legend: screenerLegend(meta.marketCapUnit), listNote: args.listNote },
  };
}

export function unavailableScreener(market: ScreenMarket): { unavailable: true; notice: { caliber: string } } {
  return { unavailable: true, notice: { caliber: "行情源暂不可用" } };
}
