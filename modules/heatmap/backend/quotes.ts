// Free quote chain for the heatmap (keyless): sina -> tencent -> eastmoney.
// Eastmoney stays DISABLED until its Mac-side re-verification passes
// (HEATMAP_EASTMONEY_ENABLED=true); the chain runs sina -> tencent meanwhile.
// Every source failure degrades to the next; a source that fails 3 consecutive
// times is skipped (circuit open) until it succeeds again. All fetches are
// server-side with a 15s timeout; the 5-minute board cache lives in publication/heatmap.ts.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const TIMEOUT_MS = 45_000; // sandbox egress proxy is slow on large batches
const CHUNK = 100;
const CHUNK_CONCURRENCY = 4;
const CIRCUIT_BREAKER_THRESHOLD = 3;

export type Market = "cn" | "hk" | "us";
export type Currency = "CNY" | "HKD" | "USD";

export interface Quote {
  code: string;          // the source's quote code, e.g. sh600519 / hk00700 / usAAPL
  name: string;
  price: number;
  changePct: number;     // percent, e.g. 1.75
  marketCap: number;     // in 亿 of the board currency; NaN when unavailable
  turnoverPct?: number;
  peTtm?: number;
}

const gbk = new TextDecoder("gbk");
async function fetchText(url: string, referer?: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": UA, ...(referer ? { referer } : {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).hostname}`);
  return gbk.decode(Buffer.from(await res.arrayBuffer()));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Run chunk jobs with bounded concurrency to cut wall time through the slow egress. */
async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

const num = (v: string | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/** sina hq.sinajs.cn batch: `var hq_str_sh600519="name,open,prev_close,price,high,low,..."` */
export async function sinaBatch(codes: string[]): Promise<Quote[]> {
  const parts = await mapPool(chunk(codes, CHUNK), CHUNK_CONCURRENCY, async (part) => {
    const text = await fetchText(`https://hq.sinajs.cn/list=${part.join(",")}`, "https://finance.sina.com.cn");
    const out: Quote[] = [];
    for (const m of text.matchAll(/var hq_str_(\w+)="([^"]*)";/g)) {
      const f = m[2]!.split(",");
      if (f.length < 6) continue;
      const price = num(f[3]);
      const prev = num(f[2]);
      if (!Number.isFinite(price) || !Number.isFinite(prev) || prev === 0) continue;
      out.push({
        code: m[1]!, name: f[0] ?? m[1]!, price,
        changePct: Math.round(((price - prev) / prev) * 10000) / 100,
        marketCap: NaN, // sina list endpoint carries no market cap
      });
    }
    return out;
  });
  const out = parts.flat();
  if (out.length === 0) throw new Error("sina returned no usable quotes");
  return out;
}

/** sina hs300 node API: constituents + quotes + mktcap in one call (100 rows/page). */
export interface SinaNodeRow {
  symbol: string; code: string; name: string; trade: string;
  changepercent: number; mktcap: number; nmc: number; per: number; pb: number; turnoverratio: number;
}
export async function sinaHs300(): Promise<SinaNodeRow[]> {
  const rows: SinaNodeRow[] = [];
  for (let page = 1; page <= 5; page++) {
    const text = await fetchText(
      `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=100&sort=symbol&asc=1&node=hs300&symbol=&_s_r_a=page`,
      "https://finance.sina.com.cn",
    );
    const arr = JSON.parse(text) as SinaNodeRow[];
    if (!Array.isArray(arr) || arr.length === 0) break;
    rows.push(...arr);
    if (arr.length < 100) break;
  }
  if (rows.length === 0) throw new Error("sina hs300 node returned nothing");
  return rows;
}

/**
 * tencent qt.gtimg.cn batch: v_sh600519="1~name~code~price~prev~open~...~change~changePct~high~low~...~turnover~pe~...~floatCap~totalCap~..."
 * Positions (0-based): 1 name, 3 price, 4 prev_close, 32 changePct, 38 turnoverPct, 39 peTtm, 44 流通市值(亿), 45 总市值(亿).
 */
export async function tencentBatch(codes: string[]): Promise<Quote[]> {
  const parts = await mapPool(chunk(codes, CHUNK), CHUNK_CONCURRENCY, async (part) => {
    const text = await fetchText(`https://qt.gtimg.cn/q=${part.join(",")}`);
    const out: Quote[] = [];
    for (const m of text.matchAll(/^v_([\w.]+)="([^"]*)";/gm)) {
      const f = m[2]!.split("~");
      if (f.length < 46) continue;
      const price = num(f[3]);
      if (!Number.isFinite(price) || price === 0) continue;
      out.push({
        code: m[1]!, name: f[1] || m[1]!, price,
        changePct: num(f[32]),
        marketCap: num(f[45]),
        turnoverPct: num(f[38]),
        peTtm: num(f[39]),
      });
    }
    return out;
  });
  const out = parts.flat();
  if (out.length === 0) throw new Error("tencent returned no usable quotes");
  return out;
}

/** eastmoney push2 batch (ulist/get). DISABLED until Mac-side re-verification passes. */
async function eastmoneyBatch(_codes: string[]): Promise<Quote[]> {
  if (process.env.HEATMAP_EASTMONEY_ENABLED !== "true") {
    throw new Error("eastmoney disabled pending Mac re-verification");
  }
  // Field map to be calibrated against the live API during Mac re-verification.
  throw new Error("eastmoney field map not yet calibrated");
}

export type QuoteSource = "sina" | "tencent" | "eastmoney";
const SOURCES: { name: QuoteSource; run: (codes: string[]) => Promise<Quote[]> }[] = [
  { name: "sina", run: sinaBatch },
  { name: "tencent", run: tencentBatch },
  { name: "eastmoney", run: eastmoneyBatch },
];

// Consecutive-failure circuits, per source. A source that fails
// CIRCUIT_BREAKER_THRESHOLD times in a row is skipped until it succeeds again.
const failures = new Map<QuoteSource, number>();

export function sourceHealth(): Record<QuoteSource, { consecutiveFailures: number; circuitOpen: boolean }> {
  return Object.fromEntries(
    SOURCES.map((s) => {
      const n = failures.get(s.name) ?? 0;
      return [s.name, { consecutiveFailures: n, circuitOpen: n >= CIRCUIT_BREAKER_THRESHOLD }];
    }),
  ) as Record<QuoteSource, { consecutiveFailures: number; circuitOpen: boolean }>;
}

/**
 * Run the chain for one batch of quote codes. Returns the quotes plus which
 * source served them. Throws when every usable source failed (the caller must
 * then show "行情源暂不可用" instead of a stale snapshot).
 */
export async function fetchQuotes(codes: string[]): Promise<{ quotes: Quote[]; source: QuoteSource }> {
  const errors: string[] = [];
  for (const s of SOURCES) {
    if ((failures.get(s.name) ?? 0) >= CIRCUIT_BREAKER_THRESHOLD) continue; // circuit open: skip
    try {
      const quotes = await s.run(codes);
      failures.set(s.name, 0);
      return { quotes, source: s.name };
    } catch (e) {
      failures.set(s.name, (failures.get(s.name) ?? 0) + 1);
      errors.push(`${s.name}: ${(e as Error).message}`);
      console.warn(`[heatmap] quote source degraded: ${s.name} failed (${failures.get(s.name)}x): ${(e as Error).message}`);
    }
  }
  throw new Error(`all quote sources failed: ${errors.join(" | ")}`);
}

/** Quote-code mapping per board/market for each source. */
export function toSinaCode(board: "hs300" | "hsi" | "ndx" | "spx", symbol: string): string {
  if (board === "hs300") return symbol;                    // already sh/sz prefixed
  if (board === "hsi") return `hk${symbol}`;               // hk00005
  return `gb_${symbol.toLowerCase()}`;                     // gb_aapl
}
export function toTencentCode(board: "hs300" | "hsi" | "ndx" | "spx", symbol: string): string {
  if (board === "hs300") return symbol;                    // sh/sz
  if (board === "hsi") return `hk${symbol}`;               // hk00005
  return `us${symbol}`;                                    // usAAPL
}
