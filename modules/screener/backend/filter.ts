/**
 * 选股器筛选/排序/分页（纯函数，单测覆盖）。
 * 只筛实测可得字段：peTtm、市值、当日涨跌幅、5日涨跌幅、换手率、名称/代码。
 */
export interface ScreenRow {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
  change5d: number | null;
  peTtm: number | null;
  marketCap: number | null;
  turnoverPct: number | null;
}

export interface ScreenQuery {
  q?: string;
  peMin?: number; peMax?: number;
  capMin?: number; capMax?: number;
  chgMin?: number; chgMax?: number;
  chg5dMin?: number; chg5dMax?: number;
  turnoverMin?: number; turnoverMax?: number;
  sort?: "changePct" | "change5d" | "peTtm" | "marketCap" | "turnoverPct" | "symbol";
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

const SORTS: Record<string, (r: ScreenRow) => number | null> = {
  changePct: (r) => r.changePct,
  change5d: (r) => r.change5d,
  peTtm: (r) => r.peTtm,
  marketCap: (r) => r.marketCap,
  turnoverPct: (r) => r.turnoverPct,
  symbol: () => null,
};

export function applyScreen(rows: ScreenRow[], q: ScreenQuery): { total: number; rows: ScreenRow[] } {
  const page = Math.max(1, Math.min(1000, q.page ?? 1));
  const pageSize = Math.max(1, Math.min(200, q.pageSize ?? 50));
  const kw = (q.q ?? "").trim().toLowerCase();

  let out = rows.filter((r) => {
    if (kw && !r.symbol.toLowerCase().includes(kw) && !r.name.toLowerCase().includes(kw)) return false;
    if (q.peMin != null && (r.peTtm == null || r.peTtm < q.peMin)) return false;
    if (q.peMax != null && (r.peTtm == null || r.peTtm > q.peMax)) return false;
    if (q.capMin != null && (r.marketCap == null || r.marketCap < q.capMin)) return false;
    if (q.capMax != null && (r.marketCap == null || r.marketCap > q.capMax)) return false;
    if (q.chgMin != null && (r.changePct == null || r.changePct < q.chgMin)) return false;
    if (q.chgMax != null && (r.changePct == null || r.changePct > q.chgMax)) return false;
    if (q.chg5dMin != null && (r.change5d == null || r.change5d < q.chg5dMin)) return false;
    if (q.chg5dMax != null && (r.change5d == null || r.change5d > q.chg5dMax)) return false;
    if (q.turnoverMin != null && (r.turnoverPct == null || r.turnoverPct < q.turnoverMin)) return false;
    if (q.turnoverMax != null && (r.turnoverPct == null || r.turnoverPct > q.turnoverMax)) return false;
    return true;
  });

  const sort = q.sort ?? "changePct";
  const dir = q.order === "asc" ? 1 : -1;
  const key = SORTS[sort] ?? SORTS.changePct;
  out = [...out].sort((a, b) => {
    if (sort === "symbol") return dir * a.symbol.localeCompare(b.symbol);
    const va = key(a), vb = key(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return dir * (va - vb);
  });

  const total = out.length;
  return { total, rows: out.slice((page - 1) * pageSize, page * pageSize) };
}

/** 5日涨跌幅：用同一 symbol 最近6个快照的收盘价推导。 */
export function change5dFromHistory(closes: (number | null)[]): number | null {
  const valid = closes.filter((c): c is number => c != null && c > 0);
  if (valid.length < 6) return null;
  const first = valid[valid.length - 1], last = valid[0];
  if (first <= 0) return null;
  return +(((last / first) - 1) * 100).toFixed(2);
}
