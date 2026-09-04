-- Disjoint buckets avoid counting the same lease in all three horizons.
SELECT l.id lease_id,p.name property,u.unit_number,t.name tenant,l.end_date,
 DATEDIFF(day,@asOf,l.end_date) days_remaining,
 CASE WHEN DATEDIFF(day,@asOf,l.end_date)<=30 THEN '0-30 days'
 WHEN DATEDIFF(day,@asOf,l.end_date)<=60 THEN '31-60 days' ELSE '61-90 days' END horizon
FROM dbo.Leases l JOIN dbo.Units u ON u.id=l.unit_id
JOIN dbo.Properties p ON p.id=u.property_id JOIN dbo.Tenants t ON t.id=l.tenant_id
WHERE l.status<>'cancelled' AND l.start_date<=@asOf AND l.end_date BETWEEN @asOf AND DATEADD(day,90,@asOf)
ORDER BY l.end_date,l.id;
