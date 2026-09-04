-- Cash is grouped by paid date, not the bill's due month. Generate empty months
-- too. Cumulative total starts at the first month in this 12-month report window.
WITH months AS (
 SELECT 0 n,DATEFROMPARTS(YEAR(DATEADD(month,-11,@asOf)),MONTH(DATEADD(month,-11,@asOf)),1) month_start
 UNION ALL SELECT n+1,DATEADD(month,1,month_start) FROM months WHERE n<11
), totals AS (
 SELECT m.month_start,COALESCE(SUM(r.amount_paise),0) collected_paise
 FROM months m LEFT JOIN dbo.PaymentReceipts r ON r.paid_date>=m.month_start
 AND r.paid_date<DATEADD(month,1,m.month_start) AND r.paid_date<=@asOf GROUP BY m.month_start)
SELECT CONVERT(char(7),month_start,120) month,collected_paise,
 SUM(collected_paise) OVER(ORDER BY month_start ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) running_total_paise
FROM totals ORDER BY month_start OPTION(MAXRECURSION 12);
