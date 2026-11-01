// Screener module backend socket: sample screening endpoint + daily snapshot schedules.
// Reads go through the publication contract (packages/backend/src/publication/screener.ts);
// quotes are fetched server-side by the worker job, never by the reader or the frontend.
import { defineServerModule } from "@aihot/backend/modules";
import { sql } from "@aihot/backend/db";
import {
  buildScreenerPayload, unavailableScreener, SCREENER_MARKETS, type ScreenMarket,
} from "@aihot/backend/publication/screener";
import { applyScreen, change5dFromHistory, type ScreenRow } from "./backend/filter.ts";
import { refreshUniverse } from "./backend/universe.ts";
import { snapshotAll } from "./backend/snapshot.ts";

function numParam(v: string | null | undefined): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// 服务端缓存 + 请求合并（规格 §3：免费档上限，禁前端直调行情源）。
// key = 完整 query string；TTL 60s；并发相同请求合并为一次 DB 查询。
const CACHE_TTL = 60_000;
const cache = new Map<string, { at: number; body: string }>();
const inflight = new Map<string, Promise<string>>();

export const screenerServer = defineServerModule({
  name: "screener",
  schedules: [
    {
      name: "screener.refresh",
      cron: "0 19 * * *", // daily after close, Asia/Shanghai
      run: async () => {
        const uni = await refreshUniverse();
        const snaps = await snapshotAll();
        console.log(`[screener] refresh done`, JSON.stringify({ uni, snaps }));
      },
    },
    {
      name: "screener.quarterly-list-reminder",
      cron: "0 9 1 */3 *", // 09:00 on the first day of each quarter
      run: async () => {
        console.warn(
          "[screener] quarterly constituent-list re-fetch due: pull HSI/NDX/SPX/HKEX-mainboard " +
          "from the index publishers, update modules/screener/data/*.json (asOf + source), " +
          "cross-check against the current universe. See SPEC-DATATOOLS.md §3.",
        );
      },
    },
  ],
  http: (app) => {
    app.get("/api/site/screener", async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      const market = q.market as ScreenMarket | undefined;
      if (!market || !SCREENER_MARKETS[market]) {
        return reply.code(400).send({ error: "bad market", market: ["a", "hk", "us"] });
      }
      const cacheKey = `screener:${req.url}`;
      const hit = cache.get(cacheKey);
      if (hit && Date.now() - hit.at < CACHE_TTL) {
        const { status, body } = JSON.parse(hit.body);
        return reply.code(status).header("cache-control", "public, max-age=60").header("x-cache", "hit").send(body);
      }
      let p = inflight.get(cacheKey);
      if (!p) {
        p = buildScreenBody(q, market).then((r) => JSON.stringify({ status: r.status, body: r.body }))
          .finally(() => { inflight.delete(cacheKey); });
        inflight.set(cacheKey, p);
      }
      const raw = await p;
      cache.set(cacheKey, { at: Date.now(), body: raw });
      const { status, body } = JSON.parse(raw);
      return reply.code(status).header("cache-control", "public, max-age=60").header("x-cache", "miss").send(body);
    });
/** 构造筛选响应体（供缓存/合并复用）。返回 {status, body}。 */
async function buildScreenBody(
  q: Record<string, string | undefined>,
  market: ScreenMarket,
): Promise<{ status: number; body: unknown }> {
      const page = Math.max(1, numParam(q.page) ?? 1);
      const pageSize = Math.max(1, Math.min(200, numParam(q.pageSize) ?? 50));

      const latest = await sql<{ d: string }[]>`
        SELECT snapshot_date::text AS d FROM screener_snapshot WHERE market=${market}
        ORDER BY snapshot_date DESC LIMIT 1`;
      if (!latest.length) {
        return { status: 503, body: { ...unavailableScreener(market), market } };
      }
      const snapDate = latest[0]!.d;
      const days = await sql<{ d: string }[]>`
        SELECT DISTINCT snapshot_date::text AS d FROM screener_snapshot WHERE market=${market}
        ORDER BY d DESC LIMIT 6`;
      const dayList = days.map((r) => r.d);
      const daySet = new Set(dayList);
      const rows = (await sql<{
        symbol: string; name: string; price: number | null; change_pct: number | null;
        pe_ttm: number | null; market_cap: number | null; turnover_pct: number | null;
        quote_source: string; snapshot_date: string;
      }[]>`
        SELECT symbol, name, price, change_pct, pe_ttm, market_cap, turnover_pct, quote_source,
               snapshot_date::text AS snapshot_date
          FROM screener_snapshot
         WHERE market=${market}`).filter((r) => daySet.has(r.snapshot_date));

      const bySymbol = new Map<string, { latest: (typeof rows)[number] | null; closes: (number | null)[] }>();
      const dayIndex = new Map(dayList.map((d, i) => [d, i]));
      for (const r of rows) {
        let e = bySymbol.get(r.symbol);
        if (!e) { e = { latest: null, closes: Array(dayList.length).fill(null) }; bySymbol.set(r.symbol, e); }
        e.closes[dayIndex.get(r.snapshot_date)!] = r.price;
        if (r.snapshot_date === snapDate) e.latest = r;
      }
      const uniCount = await sql<{ c: string }[]>`
        SELECT count(*)::text AS c FROM screener_universe WHERE market=${market} AND active`;
      const listNoteRow = await sql<{ s: string; a: string }[]>`
        SELECT list_source AS s, as_of::text AS a FROM screener_universe WHERE market=${market} AND active LIMIT 1`;

      const screenRows: ScreenRow[] = [];
      for (const [, e] of bySymbol) {
        if (!e.latest) continue;
        screenRows.push({
          symbol: e.latest.symbol,
          name: e.latest.name,
          price: e.latest.price,
          changePct: e.latest.change_pct,
          change5d: change5dFromHistory(e.closes),
          peTtm: e.latest.pe_ttm,
          marketCap: e.latest.market_cap,
          turnoverPct: e.latest.turnover_pct,
        });
      }

      const { total, rows: pageRows } = applyScreen(screenRows, {
        q: q.q,
        peMin: numParam(q.peMin), peMax: numParam(q.peMax),
        capMin: numParam(q.capMin), capMax: numParam(q.capMax),
        chgMin: numParam(q.chgMin), chgMax: numParam(q.chgMax),
        chg5dMin: numParam(q.chg5dMin), chg5dMax: numParam(q.chg5dMax),
        turnoverMin: numParam(q.turnoverMin), turnoverMax: numParam(q.turnoverMax),
        sort: (q.sort as "changePct" | "peTtm" | "marketCap" | "turnoverPct" | "symbol") ?? "changePct",
        order: (q.order as "asc" | "desc") ?? "desc",
        page, pageSize,
      });
      const first = [...bySymbol.values()].find((e) => e.latest)?.latest;
      const payload = buildScreenerPayload({
        market,
        snapshotDate: snapDate,
        universe: Number(uniCount[0]?.c ?? 0),
        total,
        page,
        pageSize,
        rows: pageRows,
        quoteSource: first?.quote_source ?? "tencent",
        listNote: listNoteRow[0] ? `成分截至 ${listNoteRow[0].a}；${listNoteRow[0].s}` : "",
      });
      return { status: 200, body: payload };
    }

    app.get("/api/site/screener/_diag", async (_req, reply) => {
      const per = await sql<{ market: string; uni: string; snaps: string; latest: string | null }[]>`
        SELECT u.market,
               (SELECT count(*)::text FROM screener_universe x WHERE x.market=u.market AND x.active) AS uni,
               (SELECT count(DISTINCT snapshot_date)::text FROM screener_snapshot x WHERE x.market=u.market) AS snaps,
               (SELECT max(snapshot_date)::text FROM screener_snapshot x WHERE x.market=u.market) AS latest
          FROM (SELECT DISTINCT market FROM screener_universe) u ORDER BY u.market`;
      return reply.send({ markets: per });
    });
  },
});
