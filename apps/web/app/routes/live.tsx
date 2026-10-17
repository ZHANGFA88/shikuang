import { useEffect, useState } from "react";
import type { Route } from "./+types/live";
import { pageMeta } from "../lib/seo";
import type { Screen } from "../components/shell/screens";
import { LiveWall, useCoarsePointer, usePosterMode } from "../features/live/LiveWall";
import { LiveBriefPanel } from "../features/live/LiveBrief";
import type { LiveChannel } from "../features/live/channels";

export const handle: Screen = { name: "直播" };

export function meta(_args: Route.MetaArgs) {
  return pageMeta({
    title: "直播",
    description: "观潮直播窗：Bloomberg TV、Yahoo Finance、DW News 三席电视直播同页静音预播，点选全屏带声；AI 陪看三栏跟着观看走，点选频道即按需生成。",
    path: "/live",
  });
}

export default function LivePage() {
  const [watching, setWatching] = useState<LiveChannel | null>(null);
  const poster = usePosterMode();
  const coarse = useCoarsePointer();
  const [dateline, setDateline] = useState("");
  useEffect(() => {
    setDateline(
      new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }),
    );
  }, []);
  return (
    <div className="pb-6">
      <p className="text-[11px] font-bold tracking-[0.3em] text-amber-ink">影像版 · THE VIDEO PAGE</p>
      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-[36px] font-semibold leading-[1.3]">观潮直播窗</h1>
        <span className="text-[12px] text-ink-2">{dateline}</span>
      </div>
      <div className="lv-rule-double mt-2.5" />
      <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold">电视直播</h2>
        <span className="text-[10px] font-bold tracking-[0.28em] text-ink-3">TELEVISION — LIVE</span>
        <span className="ml-auto text-[12px] text-ink-2">
          {coarse
            ? "第一窗静音预播中，点选任意一窗全屏收听；「陪看」切换下方结论的跟随频道"
            : "多窗同页 · 静音预播中，点选任意一窗全屏收听；「陪看」切换下方结论的跟随频道"}
        </span>
      </div>
      <LiveWall watching={watching} onWatch={setWatching} poster={poster} />
      <LiveBriefPanel watching={watching} />
      <p className="mt-7 border-t-2 border-ink pt-2.5 text-[11.5px] leading-[1.8] text-ink-2">
        版面说明：三席直播经官方嵌入端点实测可播；点选任意一窗以全屏带声播放，退出后回版本面、播放不中断。CNBC
        电视同播无官方可嵌流（仅纪录片轮播），经拍板不进版面。AI 陪看三栏实时消费后端端点 GET
        /api/site/live-brief：点选频道即按需生成该作用域要点，5 分钟内复用同卡；冷生成约 8
        秒，超时回上一轮卡或「生成中」空态，不作错误页。
      </p>
    </div>
  );
}
