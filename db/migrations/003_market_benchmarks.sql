-- Read-only public market context. No tenant or personally identifying data.
IF OBJECT_ID('dbo.MarketBenchmarks') IS NULL
BEGIN
 CREATE TABLE dbo.MarketBenchmarks (
  city nvarchar(100) NOT NULL PRIMARY KEY,
  quarter_end date NOT NULL,
  annual_change_pct decimal(6,2) NOT NULL,
  is_composite bit NOT NULL DEFAULT 0,
  CONSTRAINT ck_market_benchmark_pct CHECK(annual_change_pct BETWEEN -100 AND 100)
 );
END;
