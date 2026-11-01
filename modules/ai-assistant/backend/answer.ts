// Reader-triggered Q&A orchestration (the architecture-approved exception to
// "models only in worker jobs"). Every model call goes through receipts +
// the budget fuse; per-Q&A token cap and daily call cap are hardcoded;
// over-limit is reported honestly, never silently degraded.
import { readFileSync} from "node:fs";
import { z} from "zod";
import { sql} from "@aihot/backend/db";
import { chatJson} from "@aihot/backend/providers/llm";
import { completeReceipt} from "@aihot/backend/providers/receipts";
import { modelFor} from "@aihot/backend/editorial/models";
import { sha256} from "@aihot/backend/lib/ids";
import {
ANSWER_MAX_TOKENS,
ASSISTANT_CALIBER,
ASSISTANT_FOOTER,
ASSISTANT_HEADER,
ASSISTANT_NO_BASIS,
ASSISTANT_OVER_LIMIT,
ASSISTANT_SCOPE,
CONTEXT_MAX_CHARS,
DAILY_CAP,
QUESTION_MAX_CHARS,
RETRIEVAL_TOP_K,
SESSION_MAX_COUNT,
SESSION_MAX_MESSAGES,
type AssistantCitation,
type AssistantResponse,
type RetrievalSummary,
} from "@aihot/backend/publication/assistant";
import { checkInjection, refusalText} from "./guards.ts";
import { buildContext, makeSnippet, retrieve, type Passage} from "./retrieve.ts";
import { randomUUID} from "node:crypto";

const PROMPT_VERSION = "assistant@2026-10-29";
const SYSTEM = readFileSync(new URL("../prompts/assistant.md", import.meta.url), "utf8");

const Output = z.object({
body: z.string().min(1).max(8000),
citationIds: z.array(z.string()).max(16),
noBasis: z.boolean(),
});

const todayBeijing = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

async function usedToday(): Promise<number> {
const day = todayBeijing();
const rows = await sql<{ count: number}[]>`SELECT count FROM ai_assistant_usage WHERE day = ${day}`;
return rows[0]?.count?? 0;
}

async function bumpUsage(): Promise<number> {
const day = todayBeijing();
const rows = await sql<{ count: number}[]>`
INSERT INTO ai_assistant_usage (day, count) VALUES (${day}, 1)
ON CONFLICT (day) DO UPDATE SET count = ai_assistant_usage.count + 1
RETURNING count`;
return rows[0]!.count;
}

async function logQuery(question: string, refused: boolean, reason: string | null): Promise<void> {
await sql`INSERT INTO ai_assistant_log (question_hash, refused, reason)
VALUES (${sha256(question).slice(0, 32)}, ${refused}, ${reason})`;
}

export function retrievalSummary(strategy: "vector" | "keyword" | "none", poolSize: number): RetrievalSummary {
return {
strategy,
poolSize,
topK: RETRIEVAL_TOP_K,
dryRun: process.env.ASSISTANT_DRY_RUN === "true",
};
}

/** §2.1: citation footprint card — display-side only, never fed back to the model. */
export function toCitation(p: Passage): AssistantCitation {
return {
title: p.title,
date: p.publishedAt? p.publishedAt.slice(0, 10) : null,
url: p.url,
anchor: p.articleId, // matches the [资料N id=...] markers in the model context
snippet: makeSnippet(p.text),
};
}

/** §2.1: pure capacity check — ≤20 sessions per user, ≤200 messages per session. */
export function sessionAllowed(sessionCount: number, msgCount: number): { ok: boolean; code?: "session_limit" | "session_full" } {
if (sessionCount >= SESSION_MAX_COUNT) return { ok: false, code: "session_limit" };
if (msgCount >= SESSION_MAX_MESSAGES) return { ok: false, code: "session_full" };
return { ok: true };
}

/**
 * Resolve (or mint) a session for this ask and consume one message slot.
 * userKey is the request IP on the sample stack (no auth); production should
 * key by account id. Every user message counts toward the 200-message cap,
 * including refusals and over-limit answers.
 */
async function resolveSession(sessionId: string | undefined, userKey: string): Promise<string> {
const sid = (sessionId ?? "").trim() || randomUUID();
const existing = await sql<{ msg_count: number; user_key: string }[]>`
SELECT msg_count, user_key FROM ai_assistant_sessions WHERE session_id = ${sid}`;
if (existing.length > 0) {
const cur = existing[0]!;
const allowed = sessionAllowed(0, cur.msg_count);
if (!allowed.ok) {
throw Object.assign(new Error(`session message limit reached (${SESSION_MAX_MESSAGES})`), { status: 429, code: "session_full" });
}
await sql`UPDATE ai_assistant_sessions SET msg_count = msg_count + 1, updated_at = now() WHERE session_id = ${sid}`;
return sid;
}
const cnt = await sql<{ n: string }[]>`SELECT count(*) AS n FROM ai_assistant_sessions WHERE user_key = ${userKey}`;
const allowed = sessionAllowed(Number(cnt[0]!.n), 0);
if (!allowed.ok) {
throw Object.assign(new Error(`session limit reached (${SESSION_MAX_COUNT} per user)`), { status: 429, code: "session_limit" });
}
await sql`INSERT INTO ai_assistant_sessions (session_id, user_key, msg_count) VALUES (${sid}, ${userKey}, 1)`;
return sid;
}

function baseResponse(question: string, used: number, sessionId: string, retrieval: RetrievalSummary): Omit<AssistantResponse, "body" | "citations" | "noBasis" | "refused" | "overLimit"> {
return {
question,
header: ASSISTANT_HEADER,
footer: ASSISTANT_FOOTER,
retrieval,
sessionId,
strategy: retrieval.strategy,
usage: { usedToday: used, dailyCap: DAILY_CAP},
notice: { caliber: ASSISTANT_CALIBER, scope: ASSISTANT_SCOPE},
};
}

export async function ask(rawQuestion: string, opts?: { sessionId?: string; userKey?: string }): Promise<AssistantResponse> {
const question = rawQuestion.trim().replace(/\s+/g, " ");
if (!question) throw Object.assign(new Error("empty question"), { status: 400});
if (question.length > QUESTION_MAX_CHARS) {
throw Object.assign(new Error(`question too long (max ${QUESTION_MAX_CHARS} chars)`), { status: 400});
}

// §2.1 session capacity discipline, before any other per-ask work.
const sid = await resolveSession(opts?.sessionId, opts?.userKey ?? "unknown");

const injection = checkInjection(question);
if (injection) {
await logQuery(question, true, injection);
const used = await usedToday();
return {
...baseResponse(question, used, sid, retrievalSummary("none", 0)),
body: refusalText(injection),
citations: [],
noBasis: false,
refused: true,
overLimit: false,
};
}

const used = await usedToday();
if (used >= DAILY_CAP) {
await logQuery(question, false, "over daily cap");
return {
...baseResponse(question, used, sid, retrievalSummary("none", 0)),
body: ASSISTANT_OVER_LIMIT,
citations: [],
noBasis: false,
refused: false,
overLimit: true,
};
}

const { passages, strategy, poolSize} = await retrieve(question);
if (passages.length === 0) {
// No basis: answer without spending a model call.
await logQuery(question, false, poolSize === 0? "empty library": "no relevant passages");
return {
...baseResponse(question, used, sid, retrievalSummary(strategy, poolSize)),
body: `${ASSISTANT_NO_BASIS}。`,
citations: [],
noBasis: true,
refused: false,
overLimit: false,
};
}

const { text: context, used: usedPassages} = buildContext(passages, CONTEXT_MAX_CHARS);
if (process.env.ASSISTANT_DRY_RUN === "true") {
// Sample-stack audit hook: exercises guards -> caps -> retrieval -> context ->
// citation mapping without spending a model call. NEVER set in production.
const after = await bumpUsage();
await logQuery(question, false, "dry-run");
return {
...baseResponse(question, after, sid, retrievalSummary(strategy, poolSize)),
body: `[dry-run] 模型调用已跳过。检索到 ${usedPassages.length} 条资料（策略 ${strategy}，候选池 ${poolSize}）。`,
citations: usedPassages.map(toCitation),
noBasis: false,
refused: false,
overLimit: false,
};
}
const model = await modelFor("assistant");
const res = await chatJson({
model,
purpose: "assistant_answer",
subject: `assistant:${sha256(question).slice(0, 16)}`,
promptVersion: PROMPT_VERSION,
system: SYSTEM,
user: `用户问题：${question}\n\n（共 ${usedPassages.length} 条，来自观潮库近 ${poolSize} 篇候选）\n${context}`,
schema: Output,
temperature: 0.3,
maxTokens: ANSWER_MAX_TOKENS, // hardcoded per-Q&A token cap (prompt + context bounded above)
timeoutMs: 90_000,
});
if (res.receiptId!== null) {
await sql.begin(async (tx) => { await completeReceipt(tx, res.receiptId);});
}
const after = await bumpUsage();
await logQuery(question, false, null);

const validIds = new Set(usedPassages.map((p) => p.articleId));
const citations = [...new Set(res.data.citationIds.filter((id) => validIds.has(id)))]
.map((id) => toCitation(usedPassages.find((x) => x.articleId === id)!));
const noBasis = res.data.noBasis || citations.length === 0;
const body = noBasis && !res.data.body.includes(ASSISTANT_NO_BASIS)
? `${ASSISTANT_NO_BASIS}。${res.data.body}`
: res.data.body;
return {
...baseResponse(question, after, sid, retrievalSummary(strategy, poolSize)),
body,
citations: noBasis ? [] : citations,
noBasis,
refused: false,
overLimit: false,
};
}
