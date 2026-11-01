// Heatmap module backend socket: sample board endpoint + constituent schedules.
// Reads go through the publication contract (packages/backend/src/publication/heatmap.ts);
// quotes are fetched server-side by backend/board.ts, never by the reader.
import { defineServerModule } from "@aihot/backend/modules";
import { isBoard, type Board } from "@aihot/backend/publication/heatmap";
import { serveBoard, sourceHealth, heatmapCacheState } from "./backend/board.ts";
import { refreshConstituents } from "./backend/constituents.ts";

export const heatmapServer = defineServerModule({
  name: "heatmap",
  schedules: [
    {
      name: "heatmap.refresh-constituents",
      cron: "0 18 * * *", // daily after close, Asia/Shanghai
      run: () => refreshConstituents(),
    },
    {
      name: "heatmap.quarterly-list-reminder",
      cron: "0 9 1 */3 *", // 09:00 on the first day of each quarter
      run: async () => {
        console.warn(
          "[heatmap] quarterly constituent-list re-fetch due: pull spx/ndx/hsi from the index publishers, " +
          "update modules/heatmap/data/*.json (asOf + source), then re-run the daily validation. " +
          "See SPEC-DATATOOLS.md §1.",
        );
      },
    },
  ],
  http: (app) => {
    app.get("/api/site/heatmap", async (req, reply) => {
      const board = (req.query as { board?: string }).board ?? "hs300";
      if (!isBoard(board)) {
        return reply.status(400).send({
          type: "/problems/bad-request", title: "Bad request", status: 400,
          code: "bad_request", detail: `invalid board: ${board} (expected hs300|hsi|ndx|spx)`,
        });
      }
      const data = await serveBoard(board as Board);
      return reply.header("cache-control", "public, max-age=60").send(data);
    });
    // Diagnostics for the sample report (not reader-facing).
    app.get("/api/site/heatmap/_diag", async (_req, reply) => {
      return reply.send({ sources: sourceHealth(), cache: heatmapCacheState() });
    });
  },
});
