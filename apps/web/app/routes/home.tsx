import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/home";
import type { MonitorResponse, TimelineResponse } from "@aihot/contracts/site";
import { apiGet, cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { filterParams, hasFeedFilters, itemListLd, listPath, pageMeta, readFilters, siteLd } from "../lib/seo";
import { displayTitle } from "../lib/display-text";
import { inNav } from "../components/shell/nav";
import type { Screen } from "../components/shell/screens";
import { Timeline } from "../features/feed/Timeline";
import { SearchField } from "../features/feed/Filters";
import { Observatory, TodayCounter } from "../features/observatory/Observatory";
import { LiveWall, useCoarsePointer, usePosterMode } from "../features/live/LiveWall";
import { LiveBriefStrip } from "../features/live/LiveBrief";
import { River } from "../features/observatory/River";
import { HotWatch } from "../features/observatory/HotWatch";
import { toggleMoving, useMoving } from "../features/observatory/motion-store";
import { SITE } from "@aihot/site";

export const handle: Screen = { tab: "featured", name: "精选" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  // Search lives on /all; keep the parameters so old links still land on results.
  if (q && q.trim()) throw redirect(`/all${url.search}`);
  const filters = readFilters(url.searchParams);
  const upstream = new Headers();
  const [data, today, monitor] = await Promise.all([
    loadOr404<TimelineResponse>(listPath("/api/site/timeline", filterParams(filters)), { responseHeaders: upstream, signal: request.signal }),
    apiGet<{ collectedToday: number }>("/api/site/pool/today", { signal: request.signal }).catch(() => null),
    // HotWatch's 公开材料/信源 stats come only from monitor (SPEC §2.5); null hides the line.
    apiGet<MonitorResponse>("/api/site/monitor", { signal: request.signal }).catch(() => null),
  ]);
  return cachedPage(60, { data, filters, collectedToday: today?.collectedToday ?? 0, hotStats: monitor?.stats ?? null }, upstream);
}

export function meta({ loaderData }: Route.MetaArgs) {
  const path = listPath("/", loaderData ? filterParams(loaderData.filters) : {});
  const titles = loaderData?.data.cards.map((c) => displayTitle(c.item)) ?? [];
  return pageMeta({ path, noindex: hasFeedFilters(loaderData?.filters), jsonLd: path === "/" ? [...siteLd(), itemListLd("/", "精选", titles)] : undefined });
}

function SectionHead({ no, title, note, to, toLabel }: { no: string; title: string; note?: string; to?: string; toLabel?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-[13px] font-semibold tracking-[0.12em] text-amber-ink">{no} /</span>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {note && <span className="text-[13px] text-ink-3">{note}</span>}
      {to && <Link to={to} className="ml-auto text-[13px] font-medium text-ink-2 hover:text-accent-ink">{toLabel} ↗</Link>}
    </div>
  );
}

export default function Home() {
  const { data, collectedToday, hotStats } = useLoaderData<typeof loader>();
  const moving = useMoving();
  const poster = usePosterMode();
  const coarse = useCoarsePointer();
  return (
    <div className="pb-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.3em] text-amber-ink">MARKET · OBSERVATORY</p>
          <h1 className="mt-1.5 text-[36px] font-semibold leading-[1.3]">总览</h1>
          <p className="mt-2 text-[14.5px] text-ink-3">{SITE.subject}新闻与研究进展 · 每日精选与日报</p>
          <p className="mt-3 text-[15px]">
            今天收录
            <TodayCounter initial={collectedToday} />
            条
            <Link to="/all" className="ml-2 font-semibold text-ink hover:text-accent-ink">全部动态 ↗</Link>
            <span className={`ml-2.5 inline-block size-2 rounded-full bg-hot align-middle ${moving ? "obs-beacon" : ""}`} />
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2.5 pt-1">
          <SearchField keep={{}} />
          <button
            type="button"
            onClick={toggleMoving}
            className="whitespace-nowrap rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
          >
            {moving ? "暂停动效" : "继续动效"}
          </button>
        </div>
      </div>

      <Observatory />

      <section className="mt-8">
        <SectionHead no="03" title="新闻流" note="从来源，到话题" to="/all" toLabel="阅读完整新闻流" />
        <River />
        <div className="mt-5">
          <Timeline initial={data} filters={data.filters} />
        </div>
      </section>

      <section className="mt-8">
        {data.hot && inNav("/hot") ? (
          // HotWatch renders the full §5 header row (04 title + tabs + stats + 全部热点).
          <HotWatch entries={data.hot} stats={hotStats ? { items: hotStats.items, sources: hotStats.sources } : null} />
        ) : (
          <>
            <SectionHead no="04" title="热点观察" note="一个热点，多种声音" to="/hot" toLabel="全部热点" />
            <p className="rounded-card border border-line bg-surface px-5 py-6 text-[13.5px] text-ink-3">
              热点还在形成中——同一事件的报道积累到足够多时，这里会把它们聚成一个热点，附上各家声音。
            </p>
          </>
        )}
      </section>

      <section className="mt-8">
        <SectionHead no="05" title="电视直播" note={coarse ? "多窗同页 · 点选播放" : "多窗同页 · 静音预播"} to="/live" toLabel="完整版面" />
        <LiveWall compact poster={poster} />
        <LiveBriefStrip />
      </section>
    </div>
  );
}
