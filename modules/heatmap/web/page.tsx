// 市场热力图 · 数据工具生产页（由 frontend-datatools 样板页移植，报纸风）。
import { useCallback, useEffect, useRef, useState } from "react";
import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";

export const handle: Screen = { name: "市场热力图" };

export function meta() {
  return pageMeta({
    title: "市场热力图",
    description: "观潮数据工具：沪深300、恒生指数、纳斯达克100、标普500四板市值热力图。免费行情快照，非实时逐笔。",
    path: "/data/heatmap",
  });
}

type Board = "hs300" | "hsi" | "ndx" | "spx";
const BOARDS: Array<{ key: Board; label: string }> = [
  { key: "hs300", label: "沪深300" },
  { key: "hsi", label: "恒生指数" },
  { key: "ndx", label: "纳斯达克100" },
  { key: "spx", label: "标普500" },
];

interface Stock { symbol: string; name: string; price: number | null; changePct: number | null; marketCap: number | null; }
interface BoardPayload {
  board: string; boardName: string; snapshotLabel: string; quoteSource: string;
  marketCapUnit: string; count: number; unavailable: boolean; stale: boolean;
  stocks: Stock[];
  notice: { caliber: string; legend: string; listNote: string };
}

const UP = ["#f6c9b3", "#ec8a5f", "#cf4a12"];
const DOWN = ["#bfe0c9", "#7cbb92", "#237a44"];
const FLAT = "#cfccc2";

interface Rect { x: number; y: number; w: number; h: number; stock: Stock }

function squarify(stocks: Stock[], x: number, y: number, w: number, h: number): Rect[] {
  const total = stocks.reduce((a, s) => a + (s.marketCap ?? 0), 0);
  if (total <= 0 || w <= 0 || h <= 0) return [];
  const out: Rect[] = [];
  const items = stocks.map((s) => ({ stock: s, area: ((s.marketCap ?? 0) / total) * w * h }));
  let row: typeof items = [];
  let cx = x, cy = y, cw = w, ch = h;
  const rowArea = () => row.reduce((a, i) => a + i.area, 0);
  const worst = () => {
    const side = Math.min(cw, ch);
    const s = rowArea();
    let mx = 0, mn = Infinity;
    for (const i of row) { if (i.area > mx) mx = i.area; if (i.area < mn) mn = i.area; }
    if (mn <= 0 || s <= 0) return Infinity;
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const layoutRow = () => {
    const s = rowArea();
    if (cw >= ch) {
      const rh = s / cw;
      let rx = cx;
      for (const i of row) {
        const rw = (i.area / s) * cw;
        out.push({ x: rx, y: cy, w: rw, h: rh, stock: i.stock });
        rx += rw;
      }
      cy += rh; ch -= rh;
    } else {
      const cwid = s / ch;
      let ry = cy;
      for (const i of row) {
        const rh = (i.area / s) * ch;
        out.push({ x: cx, y: ry, w: cwid, h: rh, stock: i.stock });
        ry += rh;
      }
      cx += cwid; cw -= cwid;
    }
    row = [];
  };
  for (const it of items) {
    const before = row.length ? worst() : Infinity;
    row.push(it);
    if (row.length > 1 && worst() > before) {
      row.pop();
      layoutRow();
      row.push(it);
    }
  }
  if (row.length) layoutRow();
  return out;
}

function colorFor(changePct: number | null): string {
  if (changePct == null) return FLAT;
  const a = Math.abs(changePct);
  const band = a < 1 ? 0 : a < 3 ? 1 : 2;
  return changePct > 0 ? UP[band]! : changePct < 0 ? DOWN[band]! : FLAT;
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return (v > 0 ? "+" : "") + v.toFixed(2) + "%";
}

export default function HeatmapPage() {
  const [board, setBoard] = useState<Board>("hs300");
  const [data, setData] = useState<BoardPayload | null>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Stock | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; stock: Stock } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rectsRef = useRef<Rect[]>([]);

  const load = useCallback(async (b: Board) => {
    setErr(""); setSel(null); setTip(null);
    let d: BoardPayload | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(`/api/site/heatmap?board=${b}`, { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        d = (await r.json()) as BoardPayload;
        break;
      } catch (e) {
        if (attempt === 1) { setErr("数据加载失败（" + (e as Error).message + "），请稍后重试"); return; }
      }
    }
    if (d) setData(d);
  }, []);

  useEffect(() => { load(board); }, [board, load]);

  // 绘制 treemap
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !data || data.unavailable) return;
    const draw = () => {
      const width = wrap.clientWidth;
      const height = Math.max(420, Math.min(640, width * 0.62));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr; canvas.height = height * dpr;
      canvas.style.width = width + "px"; canvas.style.height = height + "px";
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);
      const stocks = [...data.stocks]
        .filter((s) => (s.marketCap ?? 0) > 0)
        .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
      const rects = squarify(stocks, 0, 0, width, height);
      rectsRef.current = rects;
      ctx.textBaseline = "middle";
      for (const r of rects) {
        ctx.fillStyle = colorFor(r.stock.changePct);
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = "rgba(20,20,18,.25)";
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        if (r.w > 44 && r.h > 30) {
          ctx.fillStyle = "rgba(20,20,18,.88)";
          ctx.font = "12px sans-serif";
          const label = r.stock.name.length > 6 ? r.stock.name.slice(0, 6) : r.stock.name;
          ctx.fillText(label, r.x + 6, r.y + 14, r.w - 12);
          if (r.h > 52) {
            ctx.font = "11px sans-serif";
            ctx.fillText(fmtPct(r.stock.changePct), r.x + 6, r.y + 32, r.w - 12);
          }
        }
      }
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [data]);

  const onMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rc = canvas.getBoundingClientRect();
    const x = e.clientX - rc.left, y = e.clientY - rc.top;
    const hit = rectsRef.current.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    setTip(hit ? { x: e.clientX - rc.left, y: e.clientY - rc.top, stock: hit.stock } : null);
    canvas.style.cursor = hit ? "pointer" : "default";
  };

  const onClick = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rc = canvas.getBoundingClientRect();
    const x = e.clientX - rc.left, y = e.clientY - rc.top;
    const hit = rectsRef.current.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    setSel(hit ? hit.stock : null);
  };

  return (
    <div className="dt-wrap">
      <style>{CSS}</style>
      <div className="dt-kicker">观潮 · 数据工具</div>
      <h1 className="dt-h1">市场热力图</h1>
      <div className="dt-rule-double" />
      {data?.stale && <div className="dt-stalebar">数据为昨日收盘快照</div>}
      <div className="dt-tabs" role="tablist" aria-label="板块">
        {BOARDS.map((b) => (
          <button key={b.key} data-board={b.key} aria-pressed={board === b.key}
            onClick={() => { setBoard(b.key); setData(null); }}>
            {b.label}
          </button>
        ))}
      </div>
      {data && !data.unavailable && (
        <div className="dt-meta">
          {data.boardName}　{data.snapshotLabel}（北京时间）　行情源 {data.quoteSource}
          <span className="dt-unit-chip">市值单位：{data.marketCapUnit}</span>
        </div>
      )}
      {data && (
        <div className="dt-notice">
          <p><span className="dt-lbl">口径：</span>{data.notice.caliber}</p>
          <p><span className="dt-lbl">图例：</span>{data.notice.legend}</p>
          <p><span className="dt-lbl">成分：</span>{data.notice.listNote}</p>
        </div>
      )}
      {err && <div className="dt-errbar">{err}</div>}
      {!data && !err && <div className="dt-loading">加载中…</div>}
      {data?.unavailable && (
        <div className="dt-unavailable">
          <p className="dt-un-title">{data.boardName} · 行情源暂不可用</p>
          <p>本板暂无快照可展示，不拿旧快照冒充实时。稍后再试。</p>
        </div>
      )}
      {data && !data.unavailable && (
        <div className="dt-canvas-wrap" ref={wrapRef}>
          <canvas ref={canvasRef} onMouseMove={onMove} onMouseLeave={() => setTip(null)} onClick={onClick} />
          {tip && (
            <div className="dt-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
              <b>{tip.stock.name}</b> <span className="dt-tip-sym">{tip.stock.symbol}</span><br />
              {tip.stock.price != null ? tip.stock.price.toFixed(2) : "—"}　{fmtPct(tip.stock.changePct)}
            </div>
          )}
        </div>
      )}
      {sel && (
        <div className="dt-detail">
          <b>{sel.name}</b> <span className="dt-tip-sym">{sel.symbol}</span>
          <span className="dt-detail-row">现价 {sel.price != null ? sel.price.toFixed(2) : "—"}</span>
          <span className="dt-detail-row">涨跌幅 {fmtPct(sel.changePct)}</span>
          <span className="dt-detail-row">市值 {sel.marketCap != null ? sel.marketCap.toFixed(1) + " " + (data?.marketCapUnit ?? "") : "—"}</span>
          <button className="dt-detail-close" onClick={() => setSel(null)}>关闭</button>
        </div>
      )}
      <div className="dt-rule-single" />
      <div className="dt-foot">
        生产页说明：四板成分与市值口径见上方「成分」与「图例」；快照为免费行情源收盘数据，非实时逐笔；跨板不可直接比较市值。
      </div>
    </div>
  );
}

const CSS = `
.dt-wrap{max-width:1084px;margin:0 auto;padding:28px 20px 60px;color:var(--ink)}
.dt-kicker{font-size:12px;letter-spacing:.35em;color:var(--ink-3);margin-bottom:10px}
.dt-h1{font-size:34px;font-weight:700;margin:0 0 6px;line-height:1.25}
.dt-rule-double{border-top:3px solid var(--ink);border-bottom:1px solid var(--ink);height:5px;margin:14px 0 18px}
.dt-rule-single{border-top:1px solid var(--line);margin:18px 0}
.dt-stalebar{background:var(--ink);color:var(--bg);font-size:14px;font-weight:700;padding:10px 16px;margin-bottom:14px;border-radius:2px;letter-spacing:.05em}
.dt-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}
.dt-tabs button{font:inherit;font-size:14px;padding:8px 18px;border:1px solid var(--ink);background:transparent;color:var(--ink);cursor:pointer;border-radius:2px}
.dt-tabs button[aria-pressed="true"]{background:var(--ink);color:var(--bg)}
.dt-meta{font-size:13px;color:var(--ink-3);line-height:2;margin-bottom:10px}
.dt-unit-chip{display:inline-block;border:1px solid var(--ink-2);border-radius:2px;padding:0 8px;margin-left:6px;color:var(--ink-2);font-size:12px}
.dt-notice{font-size:13px;color:var(--ink-2);line-height:1.9;border:1px dashed var(--ink-3);background:var(--bg-sunk);padding:10px 14px;margin-bottom:14px}
.dt-notice p{margin:0}
.dt-lbl{font-weight:700;color:var(--ink)}
.dt-errbar{border:1px solid #a33d12;color:#a33d12;background:#f6ece4;padding:10px 14px;font-size:13px;margin-bottom:12px;border-radius:2px}
.dt-loading{padding:40px 0;text-align:center;color:var(--ink-3);font-size:14px}
.dt-unavailable{border:1px solid var(--line);background:var(--surface);padding:34px 20px;text-align:center;color:var(--ink-2);font-size:14px;line-height:2}
.dt-un-title{font-size:17px;font-weight:700;color:var(--ink);margin:0 0 6px}
.dt-canvas-wrap{position:relative;border:1px solid var(--line);background:var(--surface)}
.dt-canvas-wrap canvas{display:block}
.dt-tip{position:absolute;pointer-events:none;background:var(--ink);color:var(--bg);font-size:12px;line-height:1.7;padding:8px 10px;border-radius:2px;z-index:5;white-space:nowrap}
.dt-tip-sym{opacity:.7}
.dt-detail{margin-top:12px;border:1px solid var(--line);background:var(--surface);padding:12px 16px;font-size:14px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.dt-detail-row{color:var(--ink-2)}
.dt-detail-close{margin-left:auto;font:inherit;font-size:13px;padding:6px 16px;border:1px solid var(--ink-2);background:transparent;color:var(--ink);border-radius:2px;cursor:pointer}
.dt-foot{margin-top:26px;font-size:12px;color:var(--ink-3);line-height:1.9}
`;
