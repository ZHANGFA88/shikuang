CREATE TABLE darkpool_weekly (
  symbol       text NOT NULL,
  week_start   date NOT NULL,
  tier         text NOT NULL DEFAULT '',
  name         text NOT NULL DEFAULT '',
  share_qty    double precision NOT NULL DEFAULT 0,
  trade_count  double precision NOT NULL DEFAULT 0,
  notional     double precision,
  published_at date NOT NULL,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, week_start)
);
