// 选股器 · 数据工具生产页（由 frontend-datatools 样板页移植，报纸风）。
// 三市场 tabs（A股全市场/港股主板/美股）+ 服务端过滤 + 分页；5日涨跌幅快照不足时置灰。
import { useEffect, useState } from "react";
import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";

export const handle: Screen = { name: "选股器" };

export function meta() {
  return pageMeta({
    title: "选股器",
    description: "观潮数据工具：A股全市场、港股主板、美股三市场选股器。免费行情快照，非实时逐笔。",
    path: "/data/screener",
  });
}

type Market = "a" | "hk" | "us";
const MARKETS: Array<{ key: Market; label: string }> = [
  { key: "a", label: "A股全市场" },
  { key: "hk", label: "港股主板" },
  { key: "us", label: "美股" },
];

interface Row {
  symbol: string; name: string; price: number | null; changePct: number | null;
  change5d: number | null; peTtm: number | null; marketCap: number | null; turnoverPct: number | null;
}
interface Payload {
  market: string; marketName: string; snapshotDate: string; snapshotAt: string; stale: boolean;
  marketCapUnit: string; quoteSource: string; universe: number; total: number; page: number; pageSize: number;
  rows: Row[]; notice: { caliber: string; legend: string; listNote: string };
}

interface Filters { q: string; peMin: string; peMax: string; capMin: string; capMax: string; chgMin: string; chgMax: string; turnMin: string }
const EMPTY: Filters = { q: "", peMin: "", peMax: "", capMin: "", capMax: "", chgMin: "", chgMax: "", turnMin: "" };

function num(v: number | null, d = 2): string { return v == null ? "—" : v.toFixed(d); }
function pct(v: number | null): string {
  if (v == null) return "—";
  return (v > 0 ? "+" : "") + v.toFixed(2) + "%";
}
function pctClass(v: number | null): string { return v == null ? "" : v > 0 ? "sc-up" : v < 0 ? "sc-down" : ""; }

export default function ScreenerPage() {
  const [market, setMarket] = useState<Market>("a");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [submitted, setSubmitted] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setErr(""); setData(null);
      const qs = new URLSearchParams({ market, page: String(page), pageSize: String(pageSize) });
      if (submitted.q.trim()) qs.set("q", submitted.q.trim());
      const numPairs: Array<[keyof Filters, string]> = [
        ["peMin", "peMin"], ["peMax", "peMax"], ["capMin", "capMin"], ["capMax", "capMax"],
        ["chgMin", "chgMin"], ["chgMax", "chgMax"], ["turnMin", "turnoverMin"],
      ];
      for (const [fk, qk] of numPairs) {
        const v = submitted[fk].trim();
        if (v !== "" && !isNaN(Number(v))) qs.set(qk, String(Number(v)));
      }
      try {
        const r = await fetch(`/api/site/screener?${qs}`, { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        if (!cancelled) setData((await r.json()) as Payload);
      } catch (e) {
        if (!cancelled) setErr("数据加载失败（" + (e as Error).message + "），请稍后重试");
      }
    })();
    return () => { cancelled = true; };
  }, [market, submitted, page, pageSize]);

  // filters 只在点"筛选"时提交，避免每次击键都请求
  const apply = () => { setSubmitted(filters); setPage(1); };
  const reset = () => { setFilters(EMPTY); setSubmitted(EMPTY); setPage(1); };
  const switchMarket = (m: Market) => { setMarket(m); setFilters(EMPTY); setSubmitted(EMPTY); setPage(1); };

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="sc-wrap">
      <style>{CSS}</style>
      <div className="sc-kicker">观潮 · 数据工具</div>
      <h1 className="sc-h1">选股器</h1>
      <div className="sc-rule-double" />
      {data?.stale && <div className="sc-stalebar">数据为昨日收盘快照</div>}
      <div className="sc-tabs" role="tablist" aria-label="市场">
        {MARKETS.map((m) => (
          <button key={m.key} aria-pressed={market === m.key} onClick={() => switchMarket(m.key)}>
            {m.label}
          </button>
        ))}
      </div>
      {data && (
        <div className="sc-meta">
          {data.marketName}　快照 {data.snapshotDate} {data.snapshotAt}（北京时间）　行情源 {data.quoteSource}
          <span className="sc-unit-chip">市值单位：{data.marketCapUnit}</span>　全市场 {data.universe} 只
        </div>
      )}
      {data && (
        <div className="sc-notice">
          <p><span className="sc-lbl">口径：</span>{data.notice.caliber}</p>
          <p><span className="sc-lbl">图例：</span>{data.notice.legend}</p>
          <p><span className="sc-lbl">成分：</span>{data.notice.listNote}</p>
        </div>
      )}
      {err && <div className="sc-errbar">{err}</div>}

      <div className="sc-filters">
        <div className="sc-fgrid">
          <div className="sc-ffield"><label>名称 / 代码搜索</label>
            <input value={filters.q} onChange={set("q")} placeholder="如：银行、600519" /></div>
          <div className="sc-ffield"><label>市盈率 TTM</label>
            <div className="sc-rng"><input value={filters.peMin} onChange={set("peMin")} inputMode="decimal" placeholder="最小" />–<input value={filters.peMax} onChange={set("peMax")} inputMode="decimal" placeholder="最大" /></div></div>
          <div className="sc-ffield"><label>市值（{data?.marketCapUnit ?? "—"}）</label>
            <div className="sc-rng"><input value={filters.capMin} onChange={set("capMin")} inputMode="decimal" placeholder="最小" />–<input value={filters.capMax} onChange={set("capMax")} inputMode="decimal" placeholder="最大" /></div></div>
          <div className="sc-ffield"><label>当日涨跌幅 %</label>
            <div className="sc-rng"><input value={filters.chgMin} onChange={set("chgMin")} inputMode="decimal" placeholder="最小" />–<input value={filters.chgMax} onChange={set("chgMax")} inputMode="decimal" placeholder="最大" /></div></div>
          <div className="sc-ffield"><label>5 日涨跌幅 %</label>
            <div className="sc-rng"><input disabled placeholder="—" />–<input disabled placeholder="—" /></div>
            <div className="sc-note">6 个快照日后可用（当前快照序列不足）</div></div>
          <div className="sc-ffield"><label>换手率 %（≥）</label>
            <input value={filters.turnMin} onChange={set("turnMin")} inputMode="decimal" placeholder="最小" /></div>
        </div>
        <div className="sc-fbtns"><button id="sc-apply" onClick={apply}>筛选</button><button id="sc-reset" onClick={reset}>重置</button></div>
      </div>

      <div className="sc-resultbar">
        <span>{data ? `筛选出 ${data.total} 只（全市场 ${data.universe} 只）` : "—"}</span>
        <div className="sc-pager">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>上一页</button>
          <span>第 {data?.page ?? page} / {pages} 页</span>
          <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}>下一页</button>
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
            <option value={20}>20/页</option><option value={50}>50/页</option><option value={100}>100/页</option>
          </select>
        </div>
      </div>
      <div className="sc-twrap"><table>
        <thead><tr><th>名称</th><th>代码</th><th>现价</th><th>涨跌幅</th><th>5日涨跌</th><th>市盈率TTM</th><th>市值</th><th>换手率</th></tr></thead>
        <tbody>
          {!data && !err && <tr className="sc-emptyrow"><td colSpan={8}>加载中…</td></tr>}
          {data && data.rows.length === 0 && <tr className="sc-emptyrow"><td colSpan={8}>无符合条件的结果，试试放宽筛选</td></tr>}
          {data?.rows.map((r) => (
            <tr key={r.symbol}>
              <td className="sc-nm">{r.name}</td><td className="sc-sym">{r.symbol}</td>
              <td>{num(r.price)}</td><td className={pctClass(r.changePct)}>{pct(r.changePct)}</td>
              <td className={pctClass(r.change5d)}>{pct(r.change5d)}</td>
              <td>{num(r.peTtm)}</td>
              <td>{r.marketCap != null ? num(r.marketCap, 1) + " " + data.marketCapUnit : "—"}</td>
              <td>{r.turnoverPct != null ? num(r.turnoverPct) + "%" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div className="sc-rule-single" />
      <div className="sc-foot">生产页说明：筛选走服务端过滤实时返回；5 日涨跌幅字段当前全空，筛选器已置灰；跨市场不可直接比较市值。</div>
    </div>
  );
}

const CSS = `
.sc-wrap{max-width:1084px;margin:0 auto;padding:28px 20px 60px;color:var(--ink)}
.sc-kicker{font-size:12px;letter-spacing:.35em;color:var(--ink-3);margin-bottom:10px}
.sc-h1{font-size:34px;font-weight:700;margin:0 0 6px;line-height:1.25}
.sc-rule-double{border-top:3px solid var(--ink);border-bottom:1px solid var(--ink);height:5px;margin:14px 0 18px}
.sc-rule-single{border-top:1px solid var(--line);margin:18px 0}
.sc-stalebar{background:var(--ink);color:var(--bg);font-size:14px;font-weight:700;padding:10px 16px;margin-bottom:14px;border-radius:2px;letter-spacing:.05em}
.sc-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}
.sc-tabs button{font:inherit;font-size:14px;padding:8px 18px;border:1px solid var(--ink);background:transparent;color:var(--ink);cursor:pointer;border-radius:2px}
.sc-tabs button[aria-pressed="true"]{background:var(--ink);color:var(--bg)}
.sc-meta{font-size:13px;color:var(--ink-3);line-height:2;margin-bottom:10px}
.sc-unit-chip{display:inline-block;border:1px solid var(--ink-2);border-radius:2px;padding:0 8px;margin-left:6px;color:var(--ink-2);font-size:12px}
.sc-notice{font-size:13px;color:var(--ink-2);line-height:1.9;border:1px dashed var(--ink-3);background:var(--bg-sunk);padding:10px 14px;margin-bottom:14px}
.sc-notice p{margin:0}
.sc-lbl{font-weight:700;color:var(--ink)}
.sc-errbar{border:1px solid #a33d12;color:#a33d12;background:#f6ece4;padding:10px 14px;font-size:13px;margin-bottom:12px;border-radius:2px}
.sc-filters{border:1px solid var(--line);background:var(--surface);padding:14px 16px;border-radius:2px}
.sc-fgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px 16px;margin-bottom:12px}
.sc-ffield label{display:block;font-size:12px;color:var(--ink-3);letter-spacing:.1em;margin-bottom:6px}
.sc-rng{display:flex;align-items:center;gap:6px}
.sc-ffield input{font:inherit;font-size:14px;padding:7px 9px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:2px;width:100%;min-width:0}
.sc-ffield input:disabled{background:var(--bg-sunk);color:var(--ink-3)}
.sc-note{font-size:11px;color:var(--ink-3);margin-top:4px;line-height:1.6}
.sc-fbtns{display:flex;gap:10px}
.sc-fbtns button{font:inherit;font-size:14px;font-weight:700;padding:9px 28px;cursor:pointer;border-radius:2px}
#sc-apply{border:1px solid var(--ink);background:var(--ink);color:var(--bg)}
#sc-reset{border:1px solid var(--ink-2);background:transparent;color:var(--ink-2)}
.sc-resultbar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin:16px 0 8px;font-size:13px;color:var(--ink-2)}
.sc-pager{display:flex;align-items:center;gap:10px;font-size:13px}
.sc-pager button{font:inherit;font-size:13px;padding:5px 14px;border:1px solid var(--ink-2);background:transparent;color:var(--ink);border-radius:2px;cursor:pointer}
.sc-pager button:disabled{opacity:.35;cursor:default}
.sc-pager select{font:inherit;font-size:13px;padding:4px 6px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:2px}
.sc-twrap{overflow-x:auto;border:1px solid var(--line);background:var(--surface)}
.sc-twrap table{border-collapse:collapse;width:100%;min-width:760px;font-size:13px}
.sc-twrap th,.sc-twrap td{padding:9px 12px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap;color:var(--ink)}
.sc-twrap th:first-child,.sc-twrap td:first-child,.sc-twrap th:nth-child(2),.sc-twrap td:nth-child(2){text-align:left}
.sc-twrap th{background:var(--bg-sunk);font-size:12px;letter-spacing:.08em;color:var(--ink-2);font-weight:700}
.sc-nm{font-weight:700}
.sc-sym{color:var(--ink-3);font-size:12px}
.sc-up{color:#c93f10;font-weight:700}.sc-down{color:#1f7a44;font-weight:700}
.sc-emptyrow td{text-align:center!important;padding:34px;color:var(--ink-3)}
.sc-foot{margin-top:26px;font-size:12px;color:var(--ink-3);line-height:1.9}
`;
