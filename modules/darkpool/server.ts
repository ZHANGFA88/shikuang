// Darkpool module backend socket: FINRA ATS weekly endpoint + weekly fetch schedule.
// Reads go through the publication contract (packages/backend/src/publication/darkpool.ts);
// FINRA is fetched server-side by the worker job, never by the reader or the frontend.
import { defineServerModule } from "@aihot/backend/modules";
import { sql } from "@aihot/backend/db";
import {
  buildDarkpoolPayload, unavailableDarkpool, delayDays, DARKPOOL_CALIBER,
  type DarkpoolWeek,
} from "@aihot/backend/publication/darkpool";
import { fetchWeekly } from "./backend/fetch.ts";

const SYMBOL_RE = /^[A-Z0-9.]{1,8}$/;

export const darkpoolServer = defineServerModule({
  name: "darkpool",
  schedules: [
    {
      name: "darkpool.fetch-weekly",
      cron: "0 10 * * 1", // Monday 10:00 Beijing, after FINRA's typical publish
      run: async () => {
        const r = await fetchWeekly();
        console.log(`[darkpool] weekly fetch done`, JSON.stringify(r));
      },
    },
  ],
  http: (app) => {
    app.get("/api/site/darkpool", async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      const symbol = (q.symbol ?? "").trim().toUpperCase();
      if (!SYMBOL_RE.test(symbol)) {
        return reply.code(400).send({ error: "bad symbol", hint: "e.g. ?symbol=AAPL" });
      }
      const weeks = await sql<{
        week_start: string; published_at: string; tier: string; name: string;
        share_qty: number; trade_count: number; notional: number | null;
      }[]>`
        SELECT week_start::text, published_at::text, tier, name, share_qty, trade_count, notional
          FROM darkpool_weekly WHERE symbol=${symbol} ORDER BY week_start DESC LIMIT 27`;
      if (!weeks.length) {
        return reply.code(404).send(unavailableDarkpool(symbol));
      }
      const w0 = weeks[0]!;
      const ats = await sql<{ mpid: string; ats_name: string; share_qty: number }[]>`
        SELECT mpid, ats_name, share_qty FROM darkpool_ats_breakdown
         WHERE symbol=${symbol} AND week_start=${w0.week_start}::date
         ORDER BY share_qty DESC LIMIT 10`;
      const weekRows: DarkpoolWeek[] = [];
      for (const w of weeks) {
        const dd = delayDays(w.week_start, w.published_at);
        if (dd == null) continue; // 延迟三要素缺任一：该周不展示
        weekRows.push({
          weekStart: w.week_start,
          publishedAt: w.published_at,
          delayDays: dd,
          shareQty: w.share_qty,
          tradeCount: w.trade_count,
          notional: w.notional,
        });
      }
      const payload = buildDarkpoolPayload({
        symbol,
        name: w0.name || symbol,
        tier: w0.tier,
        weeks: weekRows,
        topAts: ats.map((a) => ({ mpid: a.mpid, name: a.ats_name, shareQty: a.share_qty })),
      });
      return reply.header("cache-control", "public, max-age=3600").send(payload);
    });

    app.get("/api/site/darkpool/search", async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      const kw = (q.q ?? "").trim().toUpperCase();
      if (kw.length < 1 || kw.length > 12) {
        return reply.code(400).send({ error: "bad q" });
      }
      const rows = await sql<{ symbol: string; name: string }[]>`
        SELECT DISTINCT ON (symbol) symbol, name FROM darkpool_weekly
         WHERE symbol LIKE ${kw + "%"} OR upper(name) LIKE ${"%" + kw + "%"}
         ORDER BY symbol LIMIT 20`;
      return reply.send({ q: kw, results: rows });
    });

    app.get("/api/site/darkpool/_diag", async (_req, reply) => {
      const s = await sql<{ symbols: string; weeks: string; latest: string | null; oldest: string | null }[]>`
        SELECT count(DISTINCT symbol)::text AS symbols, count(DISTINCT week_start)::text AS weeks,
               max(week_start)::text AS latest, min(week_start)::text AS oldest FROM darkpool_weekly`;
      return reply.send({ ...(s[0] ?? {}), caliber: DARKPOOL_CALIBER });
    });
  },
});
