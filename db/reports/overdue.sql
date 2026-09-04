-- Reduce receipts to one row per bill before joining: partial payments must not
-- multiply the billed amount. A bill due today is not overdue.
WITH paid AS (SELECT charge_id,SUM(amount_paise) paid_paise FROM dbo.PaymentReceipts
 WHERE paid_date<=@asOf GROUP BY charge_id), debt AS (
 SELECT c.id charge_id,p.name property,u.unit_number,t.name tenant,c.due_date,
 c.amount_paise-COALESCE(r.paid_paise,0) balance_paise,DATEDIFF(day,c.due_date,@asOf) days_overdue
 FROM dbo.RentCharges c JOIN dbo.Leases l ON l.id=c.lease_id
 JOIN dbo.Units u ON u.id=l.unit_id JOIN dbo.Properties p ON p.id=u.property_id
 JOIN dbo.Tenants t ON t.id=l.tenant_id LEFT JOIN paid r ON r.charge_id=c.id
 WHERE c.due_date<@asOf AND c.amount_paise>COALESCE(r.paid_paise,0))
SELECT *,DENSE_RANK() OVER(ORDER BY days_overdue DESC,balance_paise DESC) severity_rank
FROM debt ORDER BY severity_rank,charge_id;
