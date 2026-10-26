// Sentiment module addresses (sample endpoints; the frontend sample page is a separate delivery).
import { defineModule } from "@aihot/contracts/modules";

export const sentimentModule = defineModule({
  name: "sentiment",
  apiPaths: [/^\/api\/site\/sentiment\//],
});
