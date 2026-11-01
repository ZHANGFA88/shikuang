// What the site's modules add to the web pages (site/modules/index.ts).
// P1 数据工具：三个生产模块在桌面侧栏共用「数据工具」一组（nav.ts 会合并同名 section）。
import { createElement } from "react";
import type { WebModule } from "@aihot/web/modules";

/** 与 apps/web/app/components/icons.tsx 同风格的描边图标（site 包内自包含，不反向依赖 apps/web）。 */
function icon(paths: string[]) {
  return (p: { size?: number }) =>
    createElement(
      "svg",
      {
        width: p.size ?? 18,
        height: p.size ?? 18,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.7,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
      },
      ...paths.map((d) => createElement("path", { d })),
    );
}

const IconChart = icon(["M4 20V10M10 20V4M16 20v-7M22 20H2"]);
const IconSparkles = icon([
  "M11 3.5l1.7 4.8 4.8 1.7-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7z",
  "M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z",
]);
const IconSearch = icon(["M11 4.5a6.5 6.5 0 100 13 6.5 6.5 0 100-13z", "M20 20l-4.2-4.2"]);

export const WEB_MODULES: readonly WebModule[] = [
  {
    name: "heatmap",
    sidebar: { section: "数据工具", items: [{ to: "/data/heatmap", label: "市场热力图", icon: IconChart }] },
  },
  {
    name: "ai-assistant",
    sidebar: { section: "数据工具", items: [{ to: "/data/assistant", label: "AI 投研助手", icon: IconSparkles }] },
  },
  {
    name: "screener",
    sidebar: { section: "数据工具", items: [{ to: "/data/screener", label: "选股器", icon: IconSearch }] },
  },
];
