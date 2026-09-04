-- Date predicates belong in ON so vacant units are not discarded by the join.
-- Ended leases still describe historical occupancy; only cancelled leases are excluded.
SELECT p.id property_id,p.name property,u.id unit_id,u.unit_number,t.name tenant,
 u.rent_paise listed_rent_paise,l.monthly_rent_paise contracted_rent_paise,
 CASE WHEN l.id IS NULL THEN 'vacant' ELSE 'occupied' END status
FROM dbo.Units u JOIN dbo.Properties p ON p.id=u.property_id
LEFT JOIN dbo.Leases l ON l.unit_id=u.id AND l.status<>'cancelled'
 AND @asOf BETWEEN l.start_date AND l.end_date
LEFT JOIN dbo.Tenants t ON t.id=l.tenant_id
WHERE u.available_from<=@asOf
ORDER BY p.name,u.unit_number;
