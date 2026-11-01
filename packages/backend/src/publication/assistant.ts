// AI assistant public contract (pure: no module imports, no I/O).
// The module socket (modules/ai-assistant) enforces the guards, runs retrieval and
// the (reader-triggered, receipted) model call, and shapes the response below.
//
// §2.1 amendment (2026-10-31, TSP study): the response carries a structured
// `retrieval` summary (strategy / pool size / top-K / dry-run flag) and each
// citation is a "footprint card" {title, date, url, anchor, snippet}. Footprints
// are display-side only: they are never fed back into the model context, and
// sessions store no conversation history (every ask is an independent round).
export interface AssistantCitation {
  title: string;
  date: string | null; // evidence date (YYYY-MM-DD), null when unknown
  url: string; // site-internal link: /items/<article_id> or /daily/<key>
  anchor: string; // evidence anchor: the passage id as marked [资料N id=...] in context
  snippet: string; // expandable excerpt of the cited passage (display only)
}

export interface RetrievalSummary {
  strategy: "vector" | "keyword" | "none";
  poolSize: number; // candidate passages in the retrieval pool
  topK: number; // max passages passed to the model
  dryRun: boolean; // true when ASSISTANT_DRY_RUN skipped the real model call
}

export interface AssistantResponse {
  question: string;
  header: string;   // "AI 生成、非投资建议" (page header, rendered fixed by frontend)
  body: string;     // the model's answer, markdown (must NOT repeat the compliance line)
  footer: string;   // "AI 生成、非投资建议" (page footer, rendered fixed by frontend)
  citations: AssistantCitation[];
  retrieval: RetrievalSummary;
  sessionId?: string; // echoed back so the client can continue the session
  noBasis: boolean; // true when the library has nothing relevant
  refused: boolean; // true when the question was refused (injection etc.)
  overLimit: boolean;// true when the daily Q&A budget is exhausted
  strategy: "vector" | "keyword" | "none"; // legacy alias of retrieval.strategy
  usage: { usedToday: number; dailyCap: number };
  notice: {
    caliber: string;
    scope: string;
  };
}

export const ASSISTANT_HEADER = "AI 生成、非投资建议";
export const ASSISTANT_FOOTER = "AI 生成、非投资建议";
export const ASSISTANT_NO_BASIS = "观潮库中暂无相关收录";
export const ASSISTANT_OVER_LIMIT = "今日问答额度已用完";
export const ASSISTANT_CALIBER = "基于观潮新闻库（文章/研报/日报全文）检索作答";
export const ASSISTANT_SCOPE = "仅限观潮库内已收录内容；不构成投资建议";

export const DAILY_CAP = 50;
export const QUESTION_MAX_CHARS = 200;
export const ANSWER_MAX_TOKENS = 1500;
export const CONTEXT_MAX_CHARS = 5000;
export const RETRIEVAL_TOP_K = 8;

// §2.1: tool whitelist, hardcoded in backend config. The assistant may call
// exactly these retrieval tools; any other tool name is rejected by construction
// (retrieve() iterates this list, never a client-supplied one).
export const ASSISTANT_TOOLS = ["article_search", "report_search"] as const;
export type AssistantTool = (typeof ASSISTANT_TOOLS)[number];

// §2.1: session capacity discipline — ≤20 sessions per user, ≤200 messages
// per session. Citation footprints never enter the model context.
export const SESSION_MAX_COUNT = 20;
export const SESSION_MAX_MESSAGES = 200;
export const CITATION_SNIPPET_CHARS = 150;
