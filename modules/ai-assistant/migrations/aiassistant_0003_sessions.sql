CREATE TABLE IF NOT EXISTS ai_assistant_sessions (
  session_id text PRIMARY KEY,
  user_key text NOT NULL,
  msg_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
