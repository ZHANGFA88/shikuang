// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import type { ServerModule } from "@aihot/backend/modules";
import { sentimentServer } from "@aihot/sentiment/server";
import { heatmapServer } from "@aihot/heatmap/server";
import { aiAssistantServer } from "@aihot/ai-assistant/server";
import { screenerServer } from "@aihot/screener/server";
import { darkpoolServer } from "@aihot/darkpool/server";
import { regimeServer } from "@aihot/regime/server";

export const SERVER_MODULES: readonly ServerModule[] = [sentimentServer, heatmapServer, aiAssistantServer, screenerServer, darkpoolServer, regimeServer];
