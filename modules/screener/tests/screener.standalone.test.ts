import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyScreen, change5dFromHistory, type ScreenRow, type ScreenQuery } from "../backend/filter.ts";
import { decodeBody, toTencentCode } from "../backend/quotes.ts";
import { buildScreenerPayload, SCREENER_CALIBER } from "../../../packages/backend/src/publication/screener.ts";

const rows: ScreenRow[] = [
  { symbol: "600519", name: "贵州茅台", price: 1500, changePct: 1.2, change5d: 3.1, peTtm: 28, marketCap: 18800, turnoverPct: 0.5 },
  { symbol: "000001", name: "平安银行", price: 12, changePct: -0.8, change5d: null, peTtm: 6, marketCap: 2300, turnoverPct: 1.2 },
  { symbol: "600000", name: "浦发银行", price: 8, changePct: 0.3, change5d: -1.0, peTtm: 5, marketCap: 2400, turnoverPct: 0.8 },
];

describe("applyScreen", () => {
  it("filters by pe range", () => {
    const { total, rows: r } = applyScreen(rows, { peMax: 10 });
    assert.equal(total, 2);
    assert.deepEqual(r.map((x) => x.symbol).sort(), ["000001", "600000"]);
  });
  it("null fields are excluded when filtering on that field", () => {
    const { total } = applyScreen(rows, { chg5dMin: 0 });
    assert.equal(total, 1); // 000001 has null change5d
  });
  it("sorts by changePct desc by default and paginates", () => {
    const { total, rows: r } = applyScreen(rows, { pageSize: 2 });
    assert.equal(total, 3);
    assert.equal(r[0]!.symbol, "600519");
    assert.equal(r[1]!.symbol, "600000");
  });
  it("keyword search matches symbol or name", () => {
    const { total } = applyScreen(rows, { q: "茅台" });
    assert.equal(total, 1);
  });
});

describe("change5dFromHistory", () => {
  it("needs 6 closes, newest first", () => {
    assert.equal(change5dFromHistory([110, 108, 105, 102, 101, 100]), 10);
    assert.equal(change5dFromHistory([100, null, 100]), null);
    assert.equal(change5dFromHistory([100, 100, 100, 100, 100]), null);
  });
});

describe("decodeBody", () => {
  it("decodes GBK quote payloads without U+FFFD", () => {
    // "腾讯控股" 的 GBK 字节：按 UTF-8 误解会产生 U+FFFD（P1-③ 条件 bug）
    const gbk = Buffer.from([0xcc, 0xda, 0xd1, 0xb6, 0xbf, 0xd8, 0xb9, 0xc9]);
    const text = decodeBody(gbk);
    assert.equal(text, "腾讯控股");
    assert.ok(!text.includes("�"));
  });
  it("maps bj-prefixed BSE symbols", () => {
    assert.equal(toTencentCode("a", "920000"), "bj920000");
    assert.equal(toTencentCode("a", "600519"), "sh600519");
    assert.equal(toTencentCode("a", "000001"), "sz000001");
  });
});
describe("applyScreen min/max validity", () => {
  // 架构复现：turnoverMax=1 必须真的过滤（曾返回全部 5576 只）
  it("turnoverMax filters", () => {
    const { total, rows: r } = applyScreen(rows, { turnoverMax: 1 });
    assert.equal(total, 2);
    assert.ok(r.every((x) => x.turnoverPct! <= 1));
  });
  it("every min/max pair filters its field", () => {
    const cases: [Extract<keyof ScreenQuery, string>, Extract<keyof ScreenQuery, string>, (r: ScreenRow) => number | null, number][] = [
      ["peMin", "peMax", (r) => r.peTtm, 10],
      ["capMin", "capMax", (r) => r.marketCap, 10000],
      ["chgMin", "chgMax", (r) => r.changePct, 1],
      ["chg5dMin", "chg5dMax", (r) => r.change5d, 1],
      ["turnoverMin", "turnoverMax", (r) => r.turnoverPct, 1],
    ];
    for (const [minK, maxK, get, hiVal] of cases) {
      const lo = applyScreen(rows, { [minK]: 0 } as ScreenQuery);
      assert.ok(lo.rows.every((r) => { const v = get(r); return v == null || v >= 0; }), `${minK} filters`);
      const hi = applyScreen(rows, { [maxK]: hiVal } as ScreenQuery);
      // null 值被排除 + 超上限被排除
      assert.ok(hi.rows.every((r) => { const v = get(r); return v != null && v <= hiVal; }), `${maxK} filters`);
      assert.ok(hi.total < rows.length, `${maxK} actually reduces`);
    }
  });
});

describe("buildScreenerPayload", () => {
  it("carries the fixed caliber wording and unit per market", () => {
    const p = buildScreenerPayload({
      market: "a", snapshotDate: "2026-10-29", universe: 5000, total: 10,
      page: 1, pageSize: 50, rows: [], quoteSource: "tencent", listNote: "成分截至 2026-10-29",
    });
    assert.equal(p.notice.caliber, SCREENER_CALIBER);
    assert.equal(p.marketCapUnit, "亿元人民币");
    assert.equal(p.currency, "CNY");
  });
});
