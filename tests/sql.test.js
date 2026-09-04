// Real SQL Server integration tests, never an emulation of T-SQL in SQLite.
// Requires CREATE/DROP DATABASE rights. Only the unique DB created here is dropped.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {connect,query,sql} from '../server/database.js';
import {migrate} from '../scripts/migrate.js';
import {seed} from '../scripts/seed.js';
import {Repository} from '../server/repository.js';
const base=process.env.TEST_DB_NAME;
if(!base||!/^\w+_test$/.test(base))throw new Error('TEST_DB_NAME must end in _test; a live SQL Server is required. Tests are not skipped.');
const name=`${base}_${process.pid}_${Date.now()}`;
let master,pool,repo,created=false;
before(async()=>{master=await connect('master');await query(master,`CREATE DATABASE [${name}];`);created=true;pool=await connect(name);await migrate(pool);await seed(pool,{adminPassword:'IntegrationAdmin123!',viewerPassword:'IntegrationViewer123!'});repo=new Repository(pool);});
after(async()=>{if(pool)await pool.close();if(master){if(created)await query(master,`ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}];`);await master.close();}});
test('all six reports return exact known-seed counts',async()=>{for(const [name,n] of Object.entries({'rent-roll':40,overdue:138,occupancy:48,expiry:3,maintenance:4,collection:12}))assert.equal((await repo.report(name,'2026-09-04')).length,n,name);});
test('KPI values match seed exactly',async()=>{const k=await repo.kpis('2026-09-04');assert.deepEqual(k,{total_units:40,occupied_units:32,collected_paise:44925000,open_tickets:8,overdue_count:138,occupancy_pct:80});});
test('overdue pre-aggregation and running cash total are exact',async()=>{const debt=await repo.report('overdue','2026-09-04');assert.equal(debt.reduce((n,r)=>n+r.balance_paise,0),228575000);const cash=await repo.report('collection','2026-09-04');assert.equal(cash.at(-1).running_total_paise,714025000);assert.equal(cash.at(-1).collected_paise,44925000);});
test('historical occupancy includes ended leases and preserves vacant units',async()=>{const r=await repo.report('occupancy','2026-09-04');assert.equal(r.find(x=>x.property_id===1&&x.month==='2026-06').occupied_units,9);assert.equal(r.find(x=>x.property_id===1&&x.month==='2026-07').occupied_units,8);});
test('maintenance request-weighted average and HAVING flags',async()=>{const r=await repo.report('maintenance','2026-09-04');assert.deepEqual(r.map(x=>Number(x.avg_days)),[2,4,6,8]);assert.ok(r.every(x=>Number(x.portfolio_avg_days)===5));assert.deepEqual(r.map(x=>x.above_average),[false,false,true,true]);});
test('database trigger rejects direct overlapping leases',async()=>{await assert.rejects(()=>query(pool,"INSERT dbo.Leases(tenant_id,unit_id,start_date,end_date,monthly_rent_paise,status) VALUES(1,1,'2026-09-04','2027-01-01',10000,'active')"));assert.equal((await repo.report('rent-roll','2026-09-04')).length,40);});
test('database rejects direct overpayment, duplicate receipt and invalid charge dates',async()=>{
 await assert.rejects(()=>query(pool,"INSERT dbo.PaymentReceipts(charge_id,amount_paise,paid_date,reference,method) VALUES(1,1,'2026-09-04','EXCESS','UPI')"));
 await assert.rejects(()=>query(pool,"INSERT dbo.PaymentReceipts(charge_id,amount_paise,paid_date,reference,method) VALUES(7,1,'2026-09-04','SEED-1','UPI')"));
 await assert.rejects(()=>query(pool,"INSERT dbo.RentCharges(lease_id,amount_paise,due_date,description) VALUES(9,100,'2026-09-01','outside ended lease')"));
});
test('ticket correction, audit and resolution commit together',async()=>{const t=await repo.create('tickets',{description:'Unit asking rent needs correction',related_table:'units',related_id:40,status:'open',resolution_notes:null},1);await repo.resolve(t.id,'Verified listing and corrected asking rent.',{rent_paise:3100000},1);assert.equal((await repo.get('units',40)).rent_paise,3100000);assert.equal((await repo.get('tickets',t.id)).status,'resolved');const a=(await query(pool,'SELECT * FROM dbo.AuditLog WHERE ticket_id=@id',{id:t.id})).recordset;assert.equal(a.length,1);assert.equal(JSON.parse(a[0].after_json).rent_paise,3100000);});
test('invalid correction rolls back ticket resolution',async()=>{const t=await repo.create('tickets',{description:'Verify a settled bill',related_table:'charges',related_id:1,status:'open',resolution_notes:null},1);await assert.rejects(()=>repo.resolve(t.id,'Attempt a reduction below receipts.',{amount_paise:1},1));assert.equal((await repo.get('tickets',t.id)).status,'open');assert.equal((await repo.get('charges',1)).amount_paise,1750000);});
test('simultaneous overlapping inserts cannot both survive',async()=>{const statement="INSERT dbo.Leases(tenant_id,unit_id,start_date,end_date,monthly_rent_paise,status) VALUES(1,10,'2026-10-01','2027-01-01',10000,'active')";const outcomes=await Promise.allSettled([query(pool,statement),query(pool,statement)]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal((await query(pool,'SELECT COUNT(*) n FROM dbo.Leases WHERE unit_id=10')).recordset[0].n,1);});
