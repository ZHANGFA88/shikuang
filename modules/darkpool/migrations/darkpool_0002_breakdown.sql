CREATE TABLE darkpool_ats_breakdown (
  symbol     text NOT NULL,
  week_start date NOT NULL,
  mpid       text NOT NULL,
  ats_name   text NOT NULL DEFAULT '',
  share_qty  double precision NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol, week_start, mpid)
);
