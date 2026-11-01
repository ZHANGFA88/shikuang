// Heatmap module addresses (production module: backend endpoints + frontend page).
import { defineModule } from "@aihot/contracts/modules";

export const heatmapModule = defineModule({
  name: "heatmap",
  pages: [{ path: "data/heatmap", file: "web/page.tsx", id: "data-heatmap" }],
  apiPaths: [/^\/api\/site\/heatmap/],
});
