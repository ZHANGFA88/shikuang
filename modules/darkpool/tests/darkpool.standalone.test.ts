import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aggregateRows } from "../backend/fetch.ts";
import {
  buildDarkpoolPayload, delayDays, DARKPOOL_CALIBER, unavailableDarkpool,
} from "../../../packages/backend/src/publication/darkpool.ts";

const firm = (symbol: string, mpid: string, qty: number, week = "2023-11-06", pub = "2023-11-27") => ({
  issueSymbolIdentifier: symbol,
  issueName: `${symbol} Inc`,
  MPID: mpid,
  marketParticipantName: `${mpid} ATS`,
  tierIdentifier: "T1",
  summaryStartDate: week,
  totalWeeklyTradeCount: 100,
  totalWeeklyShareQuantity: qty,
  totalNotionalSum: qty * 150,
  summaryTypeCode: "ATS_W_SMBL_FIRM",
  weekStartDate: week,
  initialPublishedDate: pub,
});

describe("aggregateRows", () => {
  it("sums FIRM rows per (symbol, week) and keeps top ATS breakdown", () => {
    const out = aggregateRows([
      firm("AAPL", "X1", 1000),
      firm("AAPL", "X2", 500),
      firm("MSFT", "X1", 200),
      { ...firm("AAPL", "X3", 100), summaryTypeCode: "ATS_W_VOL_STATS", issueSymbolIdentifier: null },
    ]);
    assert.equal(out.length, 2);
    const aapl = out.find((w) => w.symbol === "AAPL")!;
    assert.equal(aapl.shareQty, 1500);
    assert.equal(aapl.ats[0]!.mpid, "X1");
    assert.equal(aapl.ats.length, 2);
  });
  it("skips rows missing symbol/week/publishedAt", () => {
    const out = aggregateRows([firm("", "X1", 100), { ...firm("AAPL", "X1", 100), weekStartDate: null }]);
    assert.equal(out.length, 0);
  });
});

describe("delayDays", () => {
  it("computes calendar-day delay; null when either date missing", () => {
    assert.equal(delayDays("2023-11-06", "2023-11-27"), 21);
    assert.equal(delayDays(null, "2023-11-27"), null);
    assert.equal(delayDays("2023-11-06", null), null);
  });
});

describe("buildDarkpoolPayload", () => {
  it("carries the fixed caliber wording and drops weeks missing the delay triple", () => {
    const p = buildDarkpoolPayload({
      symbol: "AAPL", name: "Apple Inc", tier: "T1",
      weeks: [
        { weekStart: "2023-11-06", publishedAt: "2023-11-27", delayDays: 21, shareQty: 1, tradeCount: 1, notional: null },
        { weekStart: "", publishedAt: "2023-11-27", delayDays: NaN, shareQty: 1, tradeCount: 1, notional: null },
      ],
      topAts: [],
    });
    assert.equal(p.notice.caliber, DARKPOOL_CALIBER);
    assert.equal(p.weeks.length, 1);
    assert.equal(p.latestWeek, "2023-11-06");
    assert.match(p.notice.delayNote, /数据周/);
  });
  it("unavailable carries caliber, never a fake series", () => {
    const u = unavailableDarkpool("ZZZZ");
    assert.equal(u.unavailable, true);
    assert.equal(u.notice.caliber, DARKPOOL_CALIBER);
  });
});
