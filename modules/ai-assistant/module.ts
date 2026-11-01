// AI assistant module addresses (production module: backend endpoints + frontend page).
import { defineModule } from "@aihot/contracts/modules";

export const aiAssistantModule = defineModule({
  name: "ai-assistant",
  pages: [{ path: "data/assistant", file: "web/page.tsx", id: "data-assistant" }],
  apiPaths: [/^\/api\/site\/assistant/],
});
