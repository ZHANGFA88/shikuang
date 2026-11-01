CREATE TABLE screener_snapshot (
  market        text NOT NULL,
  symbol        text NOT NULL,
  snapshot_date date NOT NULL,
  name          text NOT NULL DEFAULT '',
  price         double precision,
  change_pct    double precision,
  pe_ttm        double precision,
  market_cap    double precision,
  market_cap_unit text NOT NULL DEFAULT '',
  turnover_pct  double precision,
  currency      text NOT NULL DEFAULT '',
  quote_source  text NOT NULL DEFAULT '',
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market, symbol, snapshot_date)
);
