// Sentiment module backend socket: sample aggregation routes + the scoring schedule + its model
// step. Reads go through the publication layer (packages/backend/src/publication/sentiment.ts);
// model calls happen only in the worker (schedule + backfill script), never in a reader's request.
import { defineServerModule } from "@aihot/backend/modules";
import { loadCalendar, loadDayAggregate, loadTopicAggregates, SENTIMENT_NOTICE, todayBeijing } from "@aihot/backend/publication/sentiment";
import { scoreRecent } from "./backend/score.ts";

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
}

function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export const sentimentServer = defineServerModule({
  name: "sentiment",
  models: {
    sentiment: {
      label: "情绪判定（方向/把握度/等级/理由）",
      env: "SENTIMENT_MODEL",
      purposes: ["sentiment_score"],
    },
  },
  schedules: [
    { name: "sentiment.score", cron: "15,45 * * * *", run: () => scoreRecent() },
  ],
  http: (app) => {
    app.get("/api/site/sentiment/day", async (req, reply) => {
      const date = (req.query as { date?: string }).date ?? todayBeijing();
      if (!isDate(date)) {
        return reply.status(400).send({ type: "/problems/bad-request", title: "Bad request", status: 400, code: "bad_request", detail: `invalid date: ${date}` });
      }
      const data = await loadDayAggregate(date);
      return reply.header("cache-control", "public, max-age=60").send({ ...SENTIMENT_NOTICE, ...data });
    });
    app.get("/api/site/sentiment/topics", async (req, reply) => {
      const date = (req.query as { date?: string }).date ?? todayBeijing();
      if (!isDate(date)) {
        return reply.status(400).send({ type: "/problems/bad-request", title: "Bad request", status: 400, code: "bad_request", detail: `invalid date: ${date}` });
      }
      const topics = await loadTopicAggregates(date);
      return reply.header("cache-control", "public, max-age=60").send({ ...SENTIMENT_NOTICE, date, topics });
    });
    app.get("/api/site/sentiment/calendar", async (req, reply) => {
      const month = (req.query as { month?: string }).month ?? todayBeijing().slice(0, 7);
      if (!isMonth(month)) {
        return reply.status(400).send({ type: "/problems/bad-request", title: "Bad request", status: 400, code: "bad_request", detail: `invalid month: ${month}` });
      }
      const days = await loadCalendar(month);
      return reply.header("cache-control", "public, max-age=60").send({ ...SENTIMENT_NOTICE, month, days });
    });
  },
});
