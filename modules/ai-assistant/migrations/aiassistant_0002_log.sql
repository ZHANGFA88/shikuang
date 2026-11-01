CREATE TABLE IF NOT EXISTS ai_assistant_log (
  id            bigserial PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  question_hash text NOT NULL,
  refused       boolean NOT NULL DEFAULT false,
  reason        text
);
