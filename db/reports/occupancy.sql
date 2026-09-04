-- SQL Server equivalent of date-series generation. Last 12 calendar months,
-- ending at @asOf: completed months use month-end; current month uses @asOf.
-- The cross join preserves every property/month, including zero inventory.
WITH months AS (
 SELECT 0 n,DATEFROMPARTS(YEAR(DATEADD(month,-11,@asOf)),MONTH(DATEADD(month,-11,@asOf)),1) month_start
 UNION ALL SELECT n+1,DATEADD(month,1,month_start) FROM months WHERE n<11
), dates AS (SELECT month_start,CASE WHEN EOMONTH(month_start)>@asOf THEN @asOf ELSE EOMONTH(month_start) END snapshot_date FROM months)
SELECT p.id property_id,p.name property,CONVERT(char(7),d.month_start,120) month,d.snapshot_date,
 COUNT(u.id) total_units,COUNT(l.id) occupied_units,
 CAST(100.0*COUNT(l.id)/NULLIF(COUNT(u.id),0) AS decimal(6,2)) occupancy_pct
FROM dbo.Properties p CROSS JOIN dates d
LEFT JOIN dbo.Units u ON u.property_id=p.id AND u.available_from<=d.snapshot_date
LEFT JOIN dbo.Leases l ON l.unit_id=u.id AND l.status<>'cancelled'
 AND d.snapshot_date BETWEEN l.start_date AND l.end_date
GROUP BY p.id,p.name,d.month_start,d.snapshot_date ORDER BY d.month_start,p.id
OPTION(MAXRECURSION 12);
