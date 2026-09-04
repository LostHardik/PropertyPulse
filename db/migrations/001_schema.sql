-- SQL Server 2022+. Dates are inclusive calendar dates; money is integer paise.
CREATE TABLE dbo.Users (
 id int IDENTITY PRIMARY KEY, name nvarchar(100) NOT NULL,
 email nvarchar(200) NOT NULL UNIQUE, password_hash varchar(100) NOT NULL,
 role varchar(10) NOT NULL CHECK(role IN ('admin','viewer')), active bit NOT NULL DEFAULT 1
);
CREATE TABLE dbo.Properties (
 id int IDENTITY PRIMARY KEY, name nvarchar(100) NOT NULL UNIQUE,
 address nvarchar(250) NOT NULL, city nvarchar(100) NOT NULL,
 created_date date NOT NULL DEFAULT CONVERT(date,SYSDATETIMEOFFSET() AT TIME ZONE 'India Standard Time')
);
-- total_units and occupancy status are derived: no stale cached copies.
CREATE TABLE dbo.Units (
 id int IDENTITY PRIMARY KEY, property_id int NOT NULL REFERENCES dbo.Properties(id),
 unit_number nvarchar(30) NOT NULL, rent_paise bigint NOT NULL CHECK(rent_paise>0),
 available_from date NOT NULL, CONSTRAINT uq_unit UNIQUE(property_id,unit_number)
);
CREATE TABLE dbo.Tenants (
 id int IDENTITY PRIMARY KEY, name nvarchar(100) NOT NULL,
 email nvarchar(200) NOT NULL UNIQUE, phone nvarchar(25) NOT NULL
);
CREATE TABLE dbo.Leases (
 id int IDENTITY PRIMARY KEY, tenant_id int NOT NULL REFERENCES dbo.Tenants(id),
 unit_id int NOT NULL REFERENCES dbo.Units(id), start_date date NOT NULL, end_date date NOT NULL,
 monthly_rent_paise bigint NOT NULL CHECK(monthly_rent_paise>0),
 status varchar(12) NOT NULL CHECK(status IN ('active','ended','cancelled')),
 CONSTRAINT ck_lease_dates CHECK(end_date>=start_date)
);
-- A bill and an actual receipt are different facts. Multiple partial receipts are allowed.
CREATE TABLE dbo.RentCharges (
 id int IDENTITY PRIMARY KEY, lease_id int NOT NULL REFERENCES dbo.Leases(id),
 amount_paise bigint NOT NULL CHECK(amount_paise>0), due_date date NOT NULL,
 description nvarchar(150) NOT NULL, CONSTRAINT uq_charge UNIQUE(lease_id,due_date)
);
CREATE TABLE dbo.PaymentReceipts (
 id int IDENTITY PRIMARY KEY, charge_id int NOT NULL REFERENCES dbo.RentCharges(id),
 amount_paise bigint NOT NULL CHECK(amount_paise>0), paid_date date NOT NULL,
 reference nvarchar(100) NOT NULL UNIQUE,
 method varchar(20) NOT NULL CHECK(method IN ('UPI','Bank transfer','Cash'))
);
CREATE TABLE dbo.MaintenanceRequests (
 id int IDENTITY PRIMARY KEY, unit_id int NOT NULL REFERENCES dbo.Units(id),
 tenant_id int NOT NULL REFERENCES dbo.Tenants(id), issue nvarchar(1000) NOT NULL,
 priority varchar(10) NOT NULL CHECK(priority IN ('low','medium','high','urgent')),
 status varchar(15) NOT NULL CHECK(status IN ('open','in_progress','resolved')),
 created_date date NOT NULL, resolved_date date NULL,
 CONSTRAINT ck_maintenance_resolution CHECK(
  (status='resolved' AND resolved_date IS NOT NULL AND resolved_date>=created_date)
  OR (status<>'resolved' AND resolved_date IS NULL))
);
CREATE TABLE dbo.SupportTickets (
 id int IDENTITY PRIMARY KEY, raised_by int NOT NULL REFERENCES dbo.Users(id),
 description nvarchar(1000) NOT NULL,
 related_table varchar(30) NOT NULL CHECK(related_table IN ('properties','units','tenants','leases','charges','receipts','maintenance')),
 related_id int NOT NULL, status varchar(15) NOT NULL CHECK(status IN ('open','investigating','resolved')),
 resolution_notes nvarchar(2000) NULL, created_date datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
 resolved_date datetime2 NULL,
 CONSTRAINT ck_ticket_resolution CHECK(
 (status='resolved' AND resolved_date IS NOT NULL AND resolution_notes IS NOT NULL AND LEN(LTRIM(RTRIM(resolution_notes)))>0 AND resolved_date>=created_date)
 OR (status<>'resolved' AND resolved_date IS NULL))
);
CREATE TABLE dbo.AuditLog (
 id bigint IDENTITY PRIMARY KEY, actor_id int NOT NULL REFERENCES dbo.Users(id),
 entity varchar(30) NOT NULL, entity_id int NOT NULL, action varchar(20) NOT NULL,
 before_json nvarchar(max) NULL, after_json nvarchar(max) NULL,
 ticket_id int NULL REFERENCES dbo.SupportTickets(id),
 created_date datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
-- Serialize lease/charge/receipt mutations at the database layer. This deliberately
-- coarse educational lock favors correctness over throughput. Triggers run inside
-- the writing transaction, so rollback also releases the transaction-owned lock.
CREATE OR ALTER TRIGGER dbo.tr_lease_integrity ON dbo.Leases AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @lock int;
 EXEC @lock=sys.sp_getapplock @Resource='PropertyPulseLedger',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
 IF @lock<0 THROW 51000,'Could not acquire ledger lock; retry the transaction.',1;
 IF EXISTS(SELECT 1 FROM dbo.Leases a JOIN dbo.Leases b WITH(UPDLOCK,HOLDLOCK)
   ON a.unit_id=b.unit_id AND a.id<b.id AND a.start_date<=b.end_date AND b.start_date<=a.end_date
   WHERE a.status<>'cancelled' AND b.status<>'cancelled')
   THROW 51001,'Lease periods overlap for this unit.',1;
 IF EXISTS(SELECT 1 FROM dbo.Leases l JOIN dbo.Units u ON u.id=l.unit_id WHERE l.start_date<u.available_from)
   THROW 51002,'Lease starts before unit availability.',1;
 IF EXISTS(SELECT 1 FROM dbo.RentCharges c JOIN dbo.Leases l ON l.id=c.lease_id
   WHERE c.due_date<l.start_date OR c.due_date>l.end_date OR l.status='cancelled')
   THROW 51003,'Existing charges prevent this lease change.',1;
 IF EXISTS(SELECT 1 FROM dbo.PaymentReceipts r JOIN dbo.RentCharges c ON c.id=r.charge_id
   JOIN dbo.Leases l ON l.id=c.lease_id WHERE r.paid_date<l.start_date)
   THROW 51004,'Existing receipt precedes lease start.',1;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_charge_integrity ON dbo.RentCharges AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @lock int;
 EXEC @lock=sys.sp_getapplock @Resource='PropertyPulseLedger',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
 IF @lock<0 THROW 51000,'Could not acquire ledger lock; retry the transaction.',1;
 IF EXISTS(SELECT 1 FROM dbo.RentCharges c JOIN dbo.Leases l ON l.id=c.lease_id
   WHERE c.due_date NOT BETWEEN l.start_date AND l.end_date OR l.status='cancelled')
   THROW 51005,'Charge must fall within a non-cancelled lease.',1;
 IF EXISTS(SELECT 1 FROM dbo.RentCharges c WHERE c.amount_paise<
   (SELECT COALESCE(SUM(r.amount_paise),0) FROM dbo.PaymentReceipts r WHERE r.charge_id=c.id))
   THROW 51006,'Charge cannot be less than its receipts.',1;
 IF EXISTS(SELECT 1 FROM dbo.PaymentReceipts r JOIN dbo.RentCharges c ON c.id=r.charge_id
   JOIN dbo.Leases l ON l.id=c.lease_id WHERE r.paid_date<l.start_date)
   THROW 51004,'Existing receipt precedes lease start.',1;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_receipt_integrity ON dbo.PaymentReceipts AFTER INSERT,UPDATE,DELETE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @lock int;
 EXEC @lock=sys.sp_getapplock @Resource='PropertyPulseLedger',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
 IF @lock<0 THROW 51000,'Could not acquire ledger lock; retry the transaction.',1;
 IF EXISTS(SELECT 1 FROM dbo.RentCharges c WHERE c.amount_paise<
   (SELECT COALESCE(SUM(r.amount_paise),0) FROM dbo.PaymentReceipts r WITH(UPDLOCK,HOLDLOCK) WHERE r.charge_id=c.id))
   THROW 51007,'Receipt exceeds the charge balance.',1;
 IF EXISTS(SELECT 1 FROM dbo.PaymentReceipts r JOIN dbo.RentCharges c ON c.id=r.charge_id
   JOIN dbo.Leases l ON l.id=c.lease_id WHERE r.paid_date<l.start_date OR r.paid_date>CONVERT(date,SYSDATETIMEOFFSET() AT TIME ZONE 'India Standard Time'))
   THROW 51008,'Invalid receipt date.',1;
END;
GO
CREATE OR ALTER TRIGGER dbo.tr_unit_integrity ON dbo.Units AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 DECLARE @lock int;
 EXEC @lock=sys.sp_getapplock @Resource='PropertyPulseLedger',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
 IF @lock<0 THROW 51000,'Could not acquire ledger lock; retry the transaction.',1;
 IF EXISTS(SELECT 1 FROM inserted u JOIN dbo.Leases l ON l.unit_id=u.id WHERE l.start_date<u.available_from)
   THROW 51009,'Availability cannot move beyond an existing lease start.',1;
END;
