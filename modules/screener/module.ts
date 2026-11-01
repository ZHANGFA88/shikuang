// Screener module addresses (production module: backend endpoints + frontend page).
import { defineModule } from "@aihot/contracts/modules";

export const screenerModule = defineModule({
  name: "screener",
  pages: [{ path: "data/screener", file: "web/page.tsx", id: "data-screener" }],
  apiPaths: [/^\/api\/site\/screener/],
});
