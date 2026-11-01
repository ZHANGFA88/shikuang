// Standalone tests for the heatmap module (no DB, no network).
// Run: node --test modules/heatmap/tests/heatmap.standalone.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assignTiers, buildBoardPayload, isBoard } from "@aihot/backend/publication/heatmap";

describe("isBoard", () => {
  it("accepts the four boards only", () => {
    assert.equal(isBoard("hs300"), true);
    assert.equal(isBoard("spx"), true);
    assert.equal(isBoard("evil"), false);
    assert.equal(isBoard(""), false);
  });
});

describe("assignTiers", () => {
  it("splits market-cap tertiles, largest = tier 1", () => {
    const rows = [9, 8, 7, 6, 5, 4, 3, 2, 1].map((marketCap) => ({ marketCap }));
    assert.deepEqual(assignTiers(rows), [1, 1, 1, 2, 2, 2, 3, 3, 3]);
  });
  it("handles a single stock", () => {
    assert.deepEqual(assignTiers([{ marketCap: 1 }]), [1]);
  });
});

describe("buildBoardPayload", () => {
  const inputs = [
    { symbol: "sh600519", name: "贵州茅台", price: 1349.99, changePct: 1.1, marketCap: 16926.1 },
    { symbol: "sh600000", name: "浦发银行", price: 11.54, changePct: -0.5, marketCap: 3327.25 },
    { symbol: "sh600001", name: "邯郸钢铁", price: 2.1, changePct: 0, marketCap: NaN }, // missing mktcap
  ];
  const payload = buildBoardPayload({
    board: "hs300", asOf: "2026-10-29", listSource: "test", inputs, quoteSource: "tencent", snapshotAt: new Date("2026-10-29T10:00:00+08:00"),
  });
  it("sorts by market cap desc and drops unusable rows", () => {
    assert.equal(payload.count, 2);
    assert.equal(payload.missing, 1);
    assert.deepEqual(payload.missingSymbols, ["sh600001"]);
    assert.equal(payload.stocks[0]!.symbol, "sh600519");
    assert.equal(payload.stocks[0]!.tier, 1);
  });
  it("marks direction and carries the caliber statements", () => {
    assert.equal(payload.stocks[0]!.direction, "up");
    assert.equal(payload.stocks[1]!.direction, "down");
    assert.match(payload.notice.caliber, /免费行情/);
    assert.match(payload.notice.caliber, /非实时逐笔/);
    assert.match(payload.notice.legend, /红涨绿跌/);
    assert.match(payload.notice.listNote, /成分截至 2026-10-29/);
    assert.equal(payload.unavailable, false);
    assert.equal(payload.marketCapUnit, "亿元人民币");
    assert.match(payload.notice.legend, /不可跨板直接比较/);
    assert.match(payload.notice.legend, /市值单位：亿元人民币/);
  });
});
