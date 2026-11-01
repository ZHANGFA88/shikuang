CREATE TABLE IF NOT EXISTS ai_assistant_usage (
  day   date NOT NULL PRIMARY KEY,
  count integer NOT NULL DEFAULT 0
);
