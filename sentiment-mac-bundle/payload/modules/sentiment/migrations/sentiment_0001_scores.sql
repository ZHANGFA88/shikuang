CREATE TABLE IF NOT EXISTS sentiment_scores (
  article_id text PRIMARY KEY REFERENCES articles(id),
  sentiment_dir text NOT NULL CHECK (sentiment_dir IN ('POS', 'NEG', 'NEU')),
  sentiment_conf numeric(3, 2) NOT NULL CHECK (sentiment_conf >= 0 AND sentiment_conf <= 1),
  impact_grade text NOT NULL CHECK (impact_grade IN ('S', 'A', 'B', 'C')),
  impact_reason text NOT NULL CHECK (char_length(impact_reason) <= 120),
  sentiment_evidence text,
  model text NOT NULL,
  prompt_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
