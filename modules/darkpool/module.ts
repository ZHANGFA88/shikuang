// Darkpool module addresses (sample endpoint; the frontend sample page is a separate delivery).
import { defineModule } from "@aihot/contracts/modules";

export const darkpoolModule = defineModule({
  name: "darkpool",
  apiPaths: [/^\/api\/site\/darkpool/],
});
