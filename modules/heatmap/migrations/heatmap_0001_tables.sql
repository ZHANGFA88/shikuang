CREATE TABLE IF NOT EXISTS heatmap_constituents (
  board      text NOT NULL,
  symbol     text NOT NULL,
  name       text NOT NULL,
  as_of      date NOT NULL,
  source     text NOT NULL,
  last_ok_at timestamptz,
  note       text,
  PRIMARY KEY (board, symbol)
);
