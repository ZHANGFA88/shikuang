// AI 陪看：实时消费后端端点 GET /api/site/live-brief（契约见后端交接 2026-10-17）。
// 打开/点选即触发该作用域生成；5 分钟内复用同卡（以 generatedAt 为准）；冷生成约 8 秒；
// 超时回上一轮卡或 404 generating——404 做「生成中」空态并 12 秒自动重试，永不当错误页。
import { useEffect, useReducer, type ReactNode } from "react";
import { Link } from "react-router";
import type { LiveChannel } from "./channels";

export type BriefScope = "all" | "bloomberg" | "yahoo" | "dw";

export interface LiveBriefData {
  generatedAt: string;
  windowLabel: string;
  briefText: string;
  relatedItems: Array<{ id: string; title: string }>;
  symbols: string[];
  scope: string;
}

type BriefState = "loading" | "ready" | "generating" | "error";
interface BriefEntry {
  state: BriefState;
  data?: LiveBriefData;
}

const cache = new Map<BriefScope, BriefEntry>();
const listeners = new Set<() => void>();
const retryTimers = new Map<BriefScope, ReturnType<typeof setTimeout>>();
const lastFetchAt = new Map<BriefScope, number>();
/** 卡面超过该时长视为陈旧，重新进页面时向后端要新卡（后端 5 分钟内仍复用同卡，成本一 GET）。 */
const STALE_MS = 5 * 60_000;

function notify() {
  listeners.forEach((f) => f());
}

async function loadBrief(scope: BriefScope) {
  const hit = cache.get(scope);
  if (hit && (hit.state === "ready" || hit.state === "loading")) return;
  lastFetchAt.set(scope, Date.now());
  cache.set(scope, { state: "loading" });
  notify();
  try {
    const res = await fetch("/api/site/live-brief" + (scope === "all" ? "" : `?channel=${scope}`));
    if (res.status === 404) {
      // 后端生成中：空态 + 12 秒后真正重拉（原实现只删缓存不重拉，界面会永停在生成中）。
      cache.set(scope, { state: "generating" });
      notify();
      const old = retryTimers.get(scope);
      if (old) clearTimeout(old);
      retryTimers.set(
        scope,
        setTimeout(() => {
          retryTimers.delete(scope);
          cache.delete(scope);
          void loadBrief(scope);
        }, 12000),
      );
      return;
    }
    if (!res.ok) throw new Error(String(res.status));
    cache.set(scope, { state: "ready", data: (await res.json()) as LiveBriefData });
  } catch {
    cache.set(scope, { state: "error" });
  }
  notify();
}

/** 陈旧检查：卡面生成时刻超过 5 分钟且距上次拉取超过 60 秒时，失效并重拉。 */
function refreshIfStale(scope: BriefScope) {
  const hit = cache.get(scope);
  if (!hit || hit.state !== "ready" || !hit.data) return;
  const age = Date.now() - new Date(hit.data.generatedAt).getTime();
  const sinceFetch = Date.now() - (lastFetchAt.get(scope) ?? 0);
  if (age > STALE_MS && sinceFetch > 60_000) {
    cache.delete(scope);
    void loadBrief(scope);
  }
}

/** 订阅某作用域的陪看卡；挂载即按契约触发生成/复用。 */
export function useLiveBrief(scope: BriefScope): BriefEntry {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);
  useEffect(() => {
    refreshIfStale(scope);
    void loadBrief(scope);
  }, [scope]);
  return cache.get(scope) ?? { state: "loading" };
}

export function fmtBriefTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function SkeletonLines({ widths }: { widths: string[] }) {
  return (
    <div className="mt-2 grid gap-1.5">
      {widths.map((w) => (
        <i key={w} className="block h-[9px] rounded-[3px] bg-bg-sunk" style={{ width: w }} />
      ))}
    </div>
  );
}

function PointsCard({ entry }: { entry: BriefEntry }) {
  if (entry.state === "loading") {
    return (
      <div className="border-t border-line py-2.5">
        <p className="text-[12.5px] text-ink-3">要点生成中…（首次冷生成约 8 秒）</p>
        <SkeletonLines widths={["92%", "70%"]} />
      </div>
    );
  }
  if (entry.state === "generating") {
    return (
      <div className="border-t border-line py-2.5">
        <p className="text-[12.5px] text-ink-3">该频道要点正在生成中，稍后自动刷新。</p>
        <SkeletonLines widths={["85%", "60%"]} />
      </div>
    );
  }
  if (entry.state === "error" || !entry.data) {
    return (
      <div className="border-t border-line py-2.5">
        <p className="text-[12.5px] text-ink-3">要点接口暂不可达，稍后重试。</p>
      </div>
    );
  }
  const d = entry.data;
  return (
    <div className="border-t border-line py-2.5">
      <div className="flex flex-wrap gap-2 text-[11px] text-ink-3">
        <span className="rounded-full border border-line px-2 py-px">{d.windowLabel}</span>
        <span className="rounded-full border border-line px-2 py-px">生成时刻 {fmtBriefTime(d.generatedAt)}</span>
      </div>
      <p className="mt-2.5 text-[14.5px] leading-[1.95] [text-align:justify]">{d.briefText}</p>
    </div>
  );
}

/** 直播页下方的 AI 陪看三栏：结论跟着观看走，未选频道时为整版总览。 */
export function LiveBriefPanel({ watching }: { watching: LiveChannel | null }) {
  const scope: BriefScope = watching?.slug ?? "all";
  const entry = useLiveBrief(scope);
  const label = watching ? watching.name : "整版总览";
  const d = entry.state === "ready" ? entry.data : undefined;
  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t-[3px] border-ink pt-3.5">
        <h2 className="text-[15px] font-semibold">AI 陪看</h2>
        <span className="text-[10px] font-bold tracking-[0.28em] text-ink-3">WATCH COMPANION</span>
        <span className="text-[12.5px] text-ink-3">
          当前观看：<b className="font-semibold text-hot">{label}</b> · 点选频道即按需生成 · 5 分钟内复用同卡（以卡面生成时刻为准）
        </span>
      </div>
      <div className="lv-cols mt-2.5 border-t border-line">
        <div className="lv-col">
          <h3 className="mb-2.5 text-[12px] font-semibold tracking-[0.14em] text-ink-3">
            AI 要点 <span className="tracking-normal text-hot">· {label}</span>
          </h3>
          <PointsCard entry={entry} />
        </div>
        <div className="lv-col">
          <h3 className="mb-2.5 text-[12px] font-semibold tracking-[0.14em] text-ink-3">
            相关资讯 <span className="tracking-normal text-hot">· {label}</span>
          </h3>
          {d ? (
            d.relatedItems.length > 0 ? (
              d.relatedItems.map((it) => (
                <div key={it.id} className="border-t border-line py-2.5">
                  <Link to={`/items/${it.id}`} className="text-[13.5px] leading-[1.6] text-ink hover:text-accent-ink">
                    {it.title}
                  </Link>
                </div>
              ))
            ) : (
              <p className="border-t border-line py-2.5 text-[12.5px] text-ink-3">该频道暂无相关资讯。</p>
            )
          ) : (
            <p className="border-t border-line py-2.5 text-[12.5px] text-ink-3">随所选频道返回。</p>
          )}
          <p className="mt-1.5 text-[11px] text-ink-3">本站条目，点进详情</p>
        </div>
        <div className="lv-col">
          <h3 className="mb-2.5 text-[12px] font-semibold tracking-[0.14em] text-ink-3">
            涉及标的 <span className="tracking-normal text-hot">· {label}</span>
          </h3>
          {d ? (
            d.symbols.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {d.symbols.map((sy) => (
                  <span key={sy} className="rounded-full border border-ink-3 px-3.5 py-1 text-[13px] font-bold">{sy}</span>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-ink-3">该频道暂未涉及标的。</p>
            )
          ) : (
            <p className="text-[12.5px] text-ink-3">随所选频道返回。</p>
          )}
          <p className="mt-1.5 text-[11px] text-ink-3">标的入口随所选频道返回</p>
        </div>
      </div>
    </div>
  );
}

/** 首页 05 的轻量摘要条：全频道活卡首句 + 进 /live 入口。 */
export function LiveBriefStrip() {
  const entry = useLiveBrief("all");
  let body: ReactNode;
  if (entry.state === "ready" && entry.data) {
    const first = entry.data.briefText.split("。")[0] + "。";
    body = (
      <span>
        <b className="font-semibold text-ink">AI 要点</b> · {entry.data.windowLabel}：{first}
      </span>
    );
  } else if (entry.state === "error") {
    body = (
      <span>
        <b className="font-semibold text-ink">AI 要点</b> · 暂不可达，进直播页查看
      </span>
    );
  } else {
    body = (
      <span>
        <b className="font-semibold text-ink">AI 要点</b> · 生成中…
      </span>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line pt-2.5 text-[13px] text-ink-2">
      {body}
      <Link to="/live" className="ml-auto whitespace-nowrap font-semibold text-ink hover:text-accent-ink">
        进直播页看 AI 陪看 →
      </Link>
    </div>
  );
}
