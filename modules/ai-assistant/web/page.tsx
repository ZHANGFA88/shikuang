// AI 投研助手 · 数据工具生产页（由 frontend-datatools 样板页移植，报纸风）。
// §2.1 修正案：合规声明前端固定渲染；引用足迹卡；检索过程摘要；三态（noBasis/refused/overLimit）。
import { useCallback, useEffect, useRef, useState } from "react";
import { pageMeta } from "@aihot/web/lib/seo";
import type { Screen } from "@aihot/web/components/shell/screens";

export const handle: Screen = { name: "AI 投研助手" };

export function meta() {
  return pageMeta({
    title: "AI 投研助手",
    description: "观潮数据工具：基于观潮新闻库（文章/研报/日报全文）检索作答的 AI 投研助手。AI 生成、非投资建议。",
    path: "/data/assistant",
  });
}

const COMPLIANCE = "AI 生成、非投资建议";
const COMPLIANCE_RE = /AI\s*生成[、，,]\s*非投资建议/g;
const SESSION_KEY = "aihot:assistant:session";
const Q_MAX = 200;

interface Citation { title: string; date: string | null; url: string; anchor: string; snippet: string }
interface AskResponse {
  question: string; body: string; citations: Citation[];
  retrieval: { strategy: "vector" | "keyword" | "none"; poolSize: number; topK: number; dryRun: boolean };
  sessionId?: string; noBasis: boolean; refused: boolean; overLimit: boolean;
  usage: { usedToday: number; dailyCap: number };
  notice: { caliber: string; scope: string };
}

interface Msg { role: "q" | "a"; text: string; resp?: AskResponse; err?: string }

function strategyLabel(s: string): string {
  return s === "vector" ? "向量检索" : s === "keyword" ? "关键词检索" : "未检索";
}

export default function AssistantPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ usedToday: number; dailyCap: number } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { setSessionId(localStorage.getItem(SESSION_KEY)); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);

  const ask = useCallback(async () => {
    const q = input.trim();
    if (!q || busy) return;
    if (q.length > Q_MAX) return;
    setBusy(true);
    setMsgs((m) => [...m, { role: "q", text: q }]);
    setInput("");
    try {
      const r = await fetch("/api/site/assistant/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, ...(sessionId ? { sessionId } : {}) }),
      });
      if (r.status === 429) {
        const d = await r.json().catch(() => ({}));
        const kind = (d as { error?: string }).error;
        setMsgs((m) => [...m, {
          role: "a", text: "",
          err: kind === "session_limit" ? "本轮会话提问次数已达上限，请开启新会话继续。"
            : kind === "session_full" ? "当前会话已满，请开启新会话继续。"
            : kind === "upstream_quota_exhausted" ? "上游模型月度配额耗尽，预计 11 月 19 日恢复（非每日额度）。"
            : "今日问答额度已用完，明日再试。",
        }]);
        return;
      }
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = (await r.json()) as AskResponse;
      if (d.sessionId) {
        setSessionId(d.sessionId);
        try { localStorage.setItem(SESSION_KEY, d.sessionId); } catch { /* ignore */ }
      }
      if (d.usage) setUsage(d.usage);
      const cleanBody = d.body.replace(COMPLIANCE_RE, "").trim();
      setMsgs((m) => [...m, { role: "a", text: cleanBody, resp: { ...d, body: cleanBody } }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "a", text: "", err: "请求失败（" + (e as Error).message + "），请稍后重试" }]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, sessionId]);

  const newSession = () => {
    setSessionId(null);
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    setMsgs((m) => [...m, { role: "q", text: "（已开启新会话）" }]);
  };

  return (
    <div className="da-wrap">
      <style>{CSS}</style>
      <div className="da-kicker">观潮 · 数据工具</div>
      <h1 className="da-h1">AI 投研助手</h1>
      <div className="da-rule-double" />
      <div className="da-compliance">{COMPLIANCE}</div>
      <div className="da-scope">基于观潮新闻库（文章/研报/日报全文）检索作答；仅限库内已收录内容；不构成投资建议。</div>

      <div className="da-thread">
        {msgs.length === 0 && !busy && (
          <div className="da-empty">
            <p>问一件事，助手去观潮库里找依据作答。</p>
            <p className="da-empty-sub">例如：最近一周关于降息的收录有哪些？SpaceX 的 Starlink 收入占比变化？</p>
            <p className="da-empty-sub">库中无相关收录时会诚实说明，不编造。</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i}>
            {m.role === "q" ? (
              <div className="da-q">{m.text}</div>
            ) : m.err ? (
              <div className="da-a da-a-err">{m.err}</div>
            ) : (
              <div className="da-a">
                {m.resp?.overLimit && <div className="da-statetag da-st-over">今日问答额度已用完</div>}
                {m.resp?.refused && <div className="da-statetag da-st-refused">该问题无法作答</div>}
                {m.resp?.noBasis && <div className="da-statetag da-st-nobasis">观潮库中暂无相关收录</div>}
                <div className="da-body">{m.text || "（空回答）"}</div>
                {m.resp && m.resp.citations.length > 0 && (
                  <div className="da-cites">
                    {m.resp.citations.map((c, j) => (
                      <details key={j} className="da-cite">
                        <summary>
                          <span className="da-cite-n">{j + 1}</span>
                          <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a>
                          {c.date && <span className="da-cite-date">{c.date}</span>}
                          <span className="da-anchor-chip">{c.anchor}</span>
                        </summary>
                        <div className="da-snippet">{c.snippet}</div>
                      </details>
                    ))}
                  </div>
                )}
                {m.resp && (
                  <div className="da-retrieval">
                    检索：{strategyLabel(m.resp.retrieval.strategy)} · 候选 {m.resp.retrieval.poolSize} 段 · 取前 {m.resp.retrieval.topK} 段
                    {m.resp.retrieval.dryRun && " · dry-run（未调用模型）"}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="da-a da-thinking">检索作答中…</div>}
        <div ref={bottomRef} />
      </div>

      <div className="da-usage-row">
        {usage && (
          <div className="da-usage">
            <div className="da-usage-bar"><div style={{ width: Math.min(100, (usage.usedToday / usage.dailyCap) * 100) + "%" }} /></div>
            <span>今日 {usage.usedToday}/{usage.dailyCap}</span>
          </div>
        )}
        <button className="da-newsession" onClick={newSession}>新会话</button>
      </div>
      <div className="da-input-row">
        <input
          value={input} maxLength={Q_MAX}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
          placeholder="输入问题（最多 200 字）…" aria-label="问题"
        />
        <button onClick={ask} disabled={busy || !input.trim()}>发送</button>
      </div>
      <div className="da-char">{input.length}/{Q_MAX}</div>
      <div className="da-compliance da-compliance-foot">{COMPLIANCE}</div>
      <div className="da-rule-single" />
      <div className="da-foot">生产页说明：每次提问为独立一轮，会话不保存对话历史；引用均为库内证据锚点，可展开查看原文片段。</div>
    </div>
  );
}

const CSS = `
.da-wrap{max-width:860px;margin:0 auto;padding:28px 20px 60px;color:var(--ink)}
.da-kicker{font-size:12px;letter-spacing:.35em;color:var(--ink-3);margin-bottom:10px}
.da-h1{font-size:34px;font-weight:700;margin:0 0 6px;line-height:1.25}
.da-rule-double{border-top:3px solid var(--ink);border-bottom:1px solid var(--ink);height:5px;margin:14px 0 18px}
.da-rule-single{border-top:1px solid var(--line);margin:18px 0}
.da-compliance{font-size:13px;font-weight:700;letter-spacing:.2em;color:var(--ink-2);margin-bottom:6px}
.da-compliance-foot{margin-top:18px}
.da-scope{font-size:13px;color:var(--ink-3);line-height:1.8;margin-bottom:16px}
.da-thread{display:flex;flex-direction:column;gap:14px;min-height:200px;margin-bottom:14px}
.da-empty{border:1px dashed var(--ink-3);background:var(--bg-sunk);padding:22px 18px;font-size:14px;color:var(--ink-2);line-height:2}
.da-empty p{margin:0}
.da-empty-sub{font-size:13px;color:var(--ink-3)}
.da-q{align-self:flex-end;max-width:85%;background:var(--ink);color:var(--bg);font-size:14px;line-height:1.8;padding:10px 14px;border-radius:2px}
.da-a{align-self:flex-start;max-width:100%;width:100%;border:1px solid var(--line);background:var(--surface);font-size:14px;line-height:1.9;padding:12px 16px;border-radius:2px}
.da-a-err{border-color:#a33d12;color:#a33d12;background:#f6ece4}
.da-thinking{color:var(--ink-3)}
.da-statetag{display:inline-block;font-size:12px;font-weight:700;padding:2px 10px;border-radius:2px;margin-bottom:8px;letter-spacing:.05em}
.da-st-nobasis{background:var(--bg-sunk);color:var(--ink-2);border:1px solid var(--ink-3)}
.da-st-refused{background:#f6ece4;color:#a33d12;border:1px solid #a33d12}
.da-st-over{background:var(--ink);color:var(--bg)}
.da-body{white-space:pre-wrap;word-break:break-word}
.da-cites{margin-top:12px;display:flex;flex-direction:column;gap:8px}
.da-cite{border:1px solid var(--line);background:var(--bg);border-radius:2px;font-size:13px}
.da-cite summary{padding:8px 12px;cursor:pointer;list-style:none;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.da-cite summary::-webkit-details-marker{display:none}
.da-cite-n{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:1px solid var(--ink-2);border-radius:50%;font-size:11px;color:var(--ink-2);flex:none}
.da-cite a{color:var(--ink);font-weight:700;text-decoration:none}
.da-cite a:hover{text-decoration:underline}
.da-cite-date{color:var(--ink-3);font-size:12px}
.da-anchor-chip{font-size:11px;border:1px solid var(--ink-3);color:var(--ink-3);border-radius:2px;padding:0 6px}
.da-snippet{padding:4px 12px 12px 40px;color:var(--ink-2);line-height:1.8;font-size:13px}
.da-retrieval{margin-top:10px;font-size:12px;color:var(--ink-3)}
.da-usage-row{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.da-usage{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-3);flex:1}
.da-usage-bar{flex:1;max-width:220px;height:6px;background:var(--bg-sunk);border-radius:3px;overflow:hidden}
.da-usage-bar div{height:100%;background:var(--ink-2)}
.da-newsession{font:inherit;font-size:13px;padding:6px 16px;border:1px solid var(--ink-2);background:transparent;color:var(--ink-2);border-radius:2px;cursor:pointer}
.da-input-row{display:flex;gap:10px}
.da-input-row input{flex:1;font:inherit;font-size:14px;padding:10px 12px;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:2px;min-width:0}
.da-input-row button{font:inherit;font-size:14px;font-weight:700;padding:10px 28px;border:1px solid var(--ink);background:var(--ink);color:var(--bg);border-radius:2px;cursor:pointer}
.da-input-row button:disabled{opacity:.4;cursor:default}
.da-char{font-size:12px;color:var(--ink-3);text-align:right;margin-top:6px}
.da-foot{margin-top:26px;font-size:12px;color:var(--ink-3);line-height:1.9}
`;
