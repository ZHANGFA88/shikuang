// AI assistant module backend socket: the reader-triggered Q&A endpoint.
// This is the architecture-approved exception to "models only in worker jobs":
// every call goes through providers/receipts.ts (receipt + budget fuse), with a
// hardcoded per-Q&A token cap and a hardcoded daily call cap; over-limit is
// reported honestly, never silently degraded.
import { defineServerModule } from "@aihot/backend/modules";
import type { AssistantResponse } from "@aihot/backend/publication/assistant";
import { ask } from "./backend/answer.ts";

export const aiAssistantServer = defineServerModule({
  name: "ai-assistant",
  models: {
    assistant: {
      label: "投研问答（读者触发）",
      env: "ASSISTANT_MODEL",
      purposes: ["assistant_answer"],
    },
  },
  http: (app) => {
    app.post("/api/site/assistant/ask", async (req, reply) => {
      const body = (req.body ?? {}) as { question?: unknown; sessionId?: unknown };
      if (typeof body.question !== "string") {
        return reply.status(400).send({
          type: "/problems/bad-request", title: "Bad request", status: 400,
          code: "bad_request", detail: "question must be a string",
        });
      }
      if (body.sessionId !== undefined && typeof body.sessionId !== "string") {
        return reply.status(400).send({
          type: "/problems/bad-request", title: "Bad request", status: 400,
          code: "bad_request", detail: "sessionId must be a string",
        });
      }
      try {
        const userKey = (req as { ip?: string }).ip ?? "unknown";
        const data: AssistantResponse = await ask(body.question, {
          sessionId: body.sessionId,
          userKey,
        });
        return reply.header("cache-control", "no-store").send(data);
      } catch (e) {
        const err = e as Error & { status?: number; code?: string };
        const status = err.status ?? 502;
        const code = err.code ?? (status === 429 ? "rate_limited" : "assistant_failed");
        return reply.status(status).send({
          type: status === 429 ? "/problems/assistant-capacity" : "/problems/assistant-failed",
          title: status === 429 ? "Assistant capacity reached" : "Assistant failed",
          status,
          code, detail: status === 400 || status === 429 ? err.message : "问答服务暂不可用",
        });
      }
    });
  },
});
