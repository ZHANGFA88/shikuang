CREATE TABLE screener_universe (
  market       text NOT NULL,
  symbol       text NOT NULL,
  name         text NOT NULL DEFAULT '',
  list_source  text NOT NULL DEFAULT '',
  as_of        date,
  active       boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market, symbol)
);
