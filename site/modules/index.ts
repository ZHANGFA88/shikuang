// The modules this site runs (modules/<name>/, see docs/architecture.md). A module has a line in each list
// it has an entry for: here for its addresses (module.ts), in server.ts for its backend, in web.ts for its
// pages' parts. Each list keeps the order its entries appear in on the site.
import type { ModuleDeclaration } from "@aihot/contracts/modules";
import { sentimentModule } from "@aihot/sentiment";
import { heatmapModule } from "@aihot/heatmap";
import { aiAssistantModule } from "@aihot/ai-assistant";
import { screenerModule } from "@aihot/screener";
import { darkpoolModule } from "@aihot/darkpool";
import { regimeModule } from "@aihot/regime";

export const MODULES: readonly ModuleDeclaration[] = [sentimentModule, heatmapModule, aiAssistantModule, screenerModule, darkpoolModule, regimeModule];
