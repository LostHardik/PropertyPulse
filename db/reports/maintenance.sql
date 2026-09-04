-- Portfolio average is REQUEST-weighted, not an average of property averages.
-- A correlated subquery computes each property's resolved-request average.
-- HAVING identifies properties above that portfolio average after grouping.
WITH portfolio AS (
 SELECT AVG(CAST(DATEDIFF(day,created_date,resolved_date) AS decimal(12,2))) average_days
 FROM dbo.MaintenanceRequests WHERE resolved_date<=@asOf AND status='resolved'
), slow AS (
 SELECT u.property_id FROM dbo.MaintenanceRequests m JOIN dbo.Units u ON u.id=m.unit_id
 WHERE m.status='resolved' AND m.resolved_date<=@asOf GROUP BY u.property_id
 HAVING AVG(CAST(DATEDIFF(day,m.created_date,m.resolved_date) AS decimal(12,2)))>(SELECT average_days FROM portfolio)
)
SELECT p.id property_id,p.name property,
 (SELECT COUNT(*) FROM dbo.MaintenanceRequests m JOIN dbo.Units u ON u.id=m.unit_id
  WHERE u.property_id=p.id AND m.status='resolved' AND m.resolved_date<=@asOf) resolved_count,
 (SELECT AVG(CAST(DATEDIFF(day,m.created_date,m.resolved_date) AS decimal(12,2)))
  FROM dbo.MaintenanceRequests m JOIN dbo.Units u ON u.id=m.unit_id
  WHERE u.property_id=p.id AND m.status='resolved' AND m.resolved_date<=@asOf) avg_days,
 a.average_days portfolio_avg_days,CAST(CASE WHEN s.property_id IS NULL THEN 0 ELSE 1 END AS bit) above_average
FROM dbo.Properties p CROSS JOIN portfolio a LEFT JOIN slow s ON s.property_id=p.id ORDER BY p.id;
