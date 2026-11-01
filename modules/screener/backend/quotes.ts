/**
 * 选股器行情抓取：腾讯批量（主）→ 新浪（备）。
 * 东财待 Mac 复验，默认关闭（SCREENER_EASTMONEY_ENABLED）。
 * 字段以实测为准：tencent [3]现价 [31]涨跌额 [32]涨跌% [33]最高 [34]最低
 * [37]成交额(万) [38]换手% [39]PE TTM [44]流通市值(亿) [45]总市值(亿) [46]PB。
 */
export interface QuoteRow {
  symbol: string;
  name: string;
  price: number | null;
  changePct: number | null;
  peTtm: number | null;
  marketCap: number | null; // 亿（对应币种）
  turnoverPct: number | null;
  source: "tencent" | "sina";
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const FETCH_TIMEOUT = 45_000;
const CHUNK = 100;
const CONCURRENCY = 4;

/** 腾讯行情返回 GBK 编码：必须按 GBK 解码，UTF-8 误解会产生 U+FFFD 坏名字。 */
export function decodeBody(buf: Buffer): string {
  return new TextDecoder("gbk").decode(buf);
}

async function fetchText(url: string, referer?: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, ...(referer ? { Referer: referer } : {}) },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return decodeBody(buf);
  } finally {
    clearTimeout(t);
  }
}

export function toTencentCode(market: string, symbol: string): string {
  if (market === "a") {
    if (symbol.startsWith("92") || symbol.startsWith("43") || symbol.startsWith("83") || symbol.startsWith("87")) return `bj${symbol}`; // 北交所
    return symbol.startsWith("6") || symbol.startsWith("9") ? `sh${symbol}` : `sz${symbol}`;
  }
  if (market === "hk") return `hk${symbol}`;
  return `us${symbol}`;
}

function num(v: string): number | null {
  if (v === undefined || v === "" || v === "--") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseTencent(text: string): Map<string, QuoteRow> {
  const out = new Map<string, QuoteRow>();
  // 注意：usBRK.B 这类代码含点，正则必须允许点
  const re = /^v_([\w.]+)="([^"]*)";/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const code = m[1];
    const f = m[2].split("~");
    if (f.length < 47) continue;
    const symbol = code.replace(/^(sh|sz|bj|hk|us)/, "");
    const name = f[1] || symbol;
    if (name.includes("�")) continue; // 转码坏名字不入库，该 symbol 计入缺失
    out.set(symbol, {
      symbol,
      name,
      price: num(f[3]),
      changePct: num(f[32]),
      peTtm: num(f[39]),
      marketCap: num(f[45]),
      turnoverPct: num(f[38]),
      source: "tencent",
    });
  }
  return out;
}

async function tencentBatch(market: string, symbols: string[]): Promise<Map<string, QuoteRow>> {
  const out = new Map<string, QuoteRow>();
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += CHUNK) chunks.push(symbols.slice(i, i + CHUNK));
  const worker = async (list: string[][]) => {
    for (const c of list) {
      const codes = c.map((s) => toTencentCode(market, s)).join(",");
      try {
        const text = await fetchText(`https://qt.gtimg.cn/q=${codes}`);
        for (const [k, v] of parseTencent(text)) out.set(k, v);
      } catch {
        // 单块失败：该块留空，由上层计入缺失
      }
    }
  };
  const lanes: string[][][] = Array.from({ length: CONCURRENCY }, () => []);
  chunks.forEach((c, i) => lanes[i % CONCURRENCY].push(c));
  await Promise.all(lanes.map(worker));
  return out;
}

/** 主入口：按市场批量抓行情，返回 symbol → QuoteRow（缺失的 symbol 不在 map 中）。 */
export async function fetchQuotes(
  market: "a" | "hk" | "us",
  symbols: string[],
): Promise<{ quotes: Map<string, QuoteRow>; quoteSource: string }> {
  const quotes = await tencentBatch(market, symbols);
  return { quotes, quoteSource: "tencent" };
}
