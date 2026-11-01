// Constituent lists for the four heatmap boards.
// hs300: dynamic, refreshed daily from the sina node API after close (18:00 Beijing).
// hsi/ndx/spx: static lists from the index publishers' public constituent tables,
// stored with an as-of date; validated daily against batch quotes (delisted or
// unreachable symbols go to the validation log); re-fetched from the publishers
// quarterly (see the quarterly-list-reminder schedule in server.ts).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "@aihot/backend/db";
import { sinaHs300 } from "./quotes.ts";

export type Board = "hs300" | "hsi" | "ndx" | "spx";
export const BOARDS: Record<Board, { boardName: string; currency: "CNY" | "HKD" | "USD"; kind: "dynamic" | "static" }> = {
  hs300: { boardName: "沪深300", currency: "CNY", kind: "dynamic" },
  hsi: { boardName: "恒生指数", currency: "HKD", kind: "static" },
  ndx: { boardName: "纳斯达克100", currency: "USD", kind: "static" },
  spx: { boardName: "标普500", currency: "USD", kind: "static" },
};

export interface Constituent { symbol: string; name: string }
interface StaticList { board: string; boardName: string; asOf: string; source: string; constituents: Constituent[] }

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

export function loadStaticList(board: "hsi" | "ndx" | "spx"): StaticList {
  return JSON.parse(readFileSync(join(dataDir, `${board}.json`), "utf-8")) as StaticList;
}

/** Constituents for a board: DB first; fallback to the static file (or live sina node for hs300). */
export async function getConstituents(board: Board): Promise<{ asOf: string; source: string; list: Constituent[] }> {
  const rows = await sql<{ symbol: string; name: string; as_of: string; source: string }[]>`
    SELECT symbol, name, as_of::text, source FROM heatmap_constituents WHERE board = ${board} ORDER BY symbol`;
  if (rows.length > 0) {
    return { asOf: rows[0]!.as_of, source: rows[0]!.source, list: rows.map((r) => ({ symbol: r.symbol, name: r.name })) };
  }
  if (board === "hs300") {
    // Sample-stack cold start: fall back to the live node API.
    const live = await sinaHs300();
    return { asOf: new Date().toISOString().slice(0, 10), source: "sina-node(live fallback)", list: live.map((r) => ({ symbol: r.symbol, name: r.name })) };
  }
  const s = loadStaticList(board);
  return { asOf: s.asOf, source: s.source, list: s.constituents };
}

const todayBeijing = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * Worker job: refresh hs300 from the sina node API; validate static boards
 * against live batch quotes. Runs daily at 18:00 Beijing (after close).
 */
export async function refreshConstituents(): Promise<{ board: Board; upserted: number; validated: number; failed: string[] }[]> {
  const { tencentBatchCodes } = await import("./validate.ts");
  const report: { board: Board; upserted: number; validated: number; failed: string[] }[] = [];
  const today = todayBeijing();
  for (const board of Object.keys(BOARDS) as Board[]) {
    const failed: string[] = [];
    let upserted = 0, validated = 0;
    if (board === "hs300") {
      const rows = await sinaHs300();
      for (const r of rows) {
        await sql`INSERT INTO heatmap_constituents (board, symbol, name, as_of, source, last_ok_at)
          VALUES (${board}, ${r.symbol}, ${r.name}, ${today}, 'sina-node', now())
          ON CONFLICT (board, symbol) DO UPDATE SET name = EXCLUDED.name, as_of = EXCLUDED.as_of, last_ok_at = now(), note = NULL`;
        upserted++;
      }
      // Remove symbols that left the index.
      const keep = new Set(rows.map((r) => r.symbol));
      const stale = await sql<{ symbol: string }[]>`SELECT symbol FROM heatmap_constituents WHERE board = ${board}`;
      for (const s of stale) {
        if (!keep.has(s.symbol)) {
          await sql`UPDATE heatmap_constituents SET note = ${`removed from index ${today}`} WHERE board = ${board} AND symbol = ${s.symbol}`;
          failed.push(`${s.symbol} (removed from index)`);
        }
      }
    } else {
      const list = loadStaticList(board);
      const results = await tencentBatchCodes(board, list.constituents.map((c) => c.symbol));
      for (const c of list.constituents) {
        const ok = results.has(c.symbol);
        await sql`INSERT INTO heatmap_constituents (board, symbol, name, as_of, source, last_ok_at, note)
          VALUES (${board}, ${c.symbol}, ${c.name}, ${list.asOf}, ${list.source}, ${ok ? new Date() : null}, ${ok ? null : `quote unreachable ${today}`})
          ON CONFLICT (board, symbol) DO UPDATE SET name = EXCLUDED.name,
            last_ok_at = CASE WHEN ${ok} THEN now() ELSE heatmap_constituents.last_ok_at END,
            note = CASE WHEN ${ok} THEN NULL ELSE ${`quote unreachable ${today}`} END`;
        if (ok) { upserted++; validated++; }
        else failed.push(`${c.symbol} (quote unreachable)`);
      }
    }
    if (failed.length > 0) {
      console.warn(`[heatmap] constituent validation ${board}: ${failed.length} failed: ${failed.slice(0, 10).join(", ")}${failed.length > 10 ? "…" : ""}`);
    }
    report.push({ board, upserted, validated, failed });
  }
  return report;
}
