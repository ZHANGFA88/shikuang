// Daily validation helper: which constituent symbols still return live quotes.
import { toTencentCode } from "./quotes.ts";

type Board = "hs300" | "hsi" | "ndx" | "spx";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** Returns the subset of symbols that produced a usable tencent quote. */
export async function tencentBatchCodes(board: Board, symbols: string[]): Promise<Set<string>> {
  const ok = new Set<string>();
  const gbk = new TextDecoder("gbk");
  for (let i = 0; i < symbols.length; i += 100) {
    const part = symbols.slice(i, i + 100);
    const codes = part.map((s) => toTencentCode(board, s));
    try {
      const res = await fetch(`https://qt.gtimg.cn/q=${codes.join(",")}`, {
        headers: { "user-agent": UA },
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) continue;
      const text = gbk.decode(Buffer.from(await res.arrayBuffer()));
      const seen = new Set<string>();
      for (const m of text.matchAll(/^v_([\w.]+)="([^"]*)";/gm)) {
        const f = m[2]!.split("~");
        if (f.length >= 46 && Number(f[3]) > 0) seen.add(m[1]!);
      }
      // Map tencent codes back to constituent symbols.
      part.forEach((s, idx) => { if (seen.has(codes[idx]!)) ok.add(s); });
    } catch {
      // validation is best-effort; failures are logged by the caller
    }
    await new Promise((r) => setTimeout(r, 500)); // polite pacing
  }
  return ok;
}
