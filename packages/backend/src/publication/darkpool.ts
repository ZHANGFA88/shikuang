/**
 * 暗池追踪公开契约（publication 层）：纯函数。
 * 口径文案逐字固定，生产前由架构逐字审。
 * 延迟三要素（数据周/发布日期/延迟天数）缺一不可，缺任一 = 不合格样板。
 */
export const DARKPOOL_CALIBER = "FINRA ATS 周度数据，延迟约两周，仅供趋势参考，非实时信号";
export const DARKPOOL_SCOPE = "仅覆盖美股 NMS（纳斯达克/纽交所上市）证券，不含 A股/港股";
export const DARKPOOL_SOURCE = "FINRA OTC Transparency Weekly Summary（官方 Query API，免费）";

export interface DarkpoolWeek {
  weekStart: string;      // 数据周（周一）
  publishedAt: string;    // 发布日期
  delayDays: number;      // 延迟天数 = 发布日期 − 数据周一
  shareQty: number;       // 该周 ATS 总股数
  tradeCount: number;     // 该周 ATS 总笔数
  notional: number | null;// 该周名义金额（美元）
}

export interface DarkpoolAtsSlice {
  mpid: string;
  name: string;
  shareQty: number;
}

export interface DarkpoolPayload {
  symbol: string;
  name: string;
  tier: string;
  weeks: DarkpoolWeek[];
  topAts: DarkpoolAtsSlice[]; // 最新一周分 ATS 明细（柱状图用）
  latestWeek: string | null;
  notice: { caliber: string; scope: string; source: string; delayNote: string };
}

/** 延迟天数：发布日期 − 数据周一（自然日）。任一缺失返回 null，调用方不得展示该周。 */
export function delayDays(weekStart: string | null, publishedAt: string | null): number | null {
  if (!weekStart || !publishedAt) return null;
  const ms = new Date(publishedAt).getTime() - new Date(weekStart).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 86_400_000);
}

export function buildDarkpoolPayload(args: {
  symbol: string; name: string; tier: string;
  weeks: DarkpoolWeek[]; topAts: DarkpoolAtsSlice[];
}): DarkpoolPayload {
  const weeks = args.weeks.filter((w) => w.weekStart && w.publishedAt && Number.isFinite(w.delayDays));
  return {
    symbol: args.symbol,
    name: args.name,
    tier: args.tier,
    weeks,
    topAts: args.topAts,
    latestWeek: weeks.length ? weeks[0]!.weekStart : null,
    notice: {
      caliber: DARKPOOL_CALIBER,
      scope: DARKPOOL_SCOPE,
      source: DARKPOOL_SOURCE,
      delayNote: "延迟三要素：数据周 weeks[].weekStart／发布日期 weeks[].publishedAt／延迟天数 weeks[].delayDays",
    },
  };
}

export function unavailableDarkpool(symbol: string): { unavailable: true; symbol: string; notice: { caliber: string; scope: string } } {
  return { unavailable: true, symbol, notice: { caliber: DARKPOOL_CALIBER, scope: DARKPOOL_SCOPE } };
}
