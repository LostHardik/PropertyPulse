import {readFile} from 'node:fs/promises';
import {models,parseRecord} from './models.js';
import {query,transaction} from './database.js';
import {marketSnapshot} from '../data/nhb-residex-march-2026.js';
export const reportNames=['rent-roll','overdue','occupancy','expiry','maintenance','collection'];
const reports=Object.fromEntries(await Promise.all(reportNames.map(async n=>[n,await readFile(new URL(`../db/reports/${n}.sql`,import.meta.url),'utf8')])));
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function table(entity){if(!models[entity])fail('Unknown entity',404);return `dbo.[${models[entity].table}]`;}
function normalize(row){return row&&Object.fromEntries(Object.entries(row).map(([k,v])=>{
 if(k.endsWith('_paise')&&v!==null){const amount=Number(v);if(!Number.isSafeInteger(amount))throw new Error('Currency total exceeds safe JSON integer range');return [k,amount];}
 return [k,v instanceof Date?('resolution_notes'in row?v.toISOString():v.toISOString().slice(0,10)):v];
}));}
export class Repository{
 constructor(pool){this.pool=pool;}
 async userByEmail(email){return (await query(this.pool,'SELECT * FROM dbo.Users WHERE email=@email',{email})).recordset[0];}
 async userByRole(role){return (await query(this.pool,'SELECT TOP (1) * FROM dbo.Users WHERE role=@role AND active=1 ORDER BY id',{role})).recordset[0];}
 async userById(id){return (await query(this.pool,'SELECT id,name,email,role,active FROM dbo.Users WHERE id=@id',{id})).recordset[0];}
 async marketBenchmarks(){
  const rows=(await query(this.pool,'SELECT city,CONVERT(varchar(10),quarter_end,23) quarter_end,CONVERT(float,annual_change_pct) annual_change_pct,is_composite composite FROM dbo.MarketBenchmarks ORDER BY is_composite,annual_change_pct DESC')).recordset;
  return {...marketSnapshot,rows};
 }
 async get(entity,id,connection=this.pool){return normalize((await query(connection,`SELECT * FROM ${table(entity)} WHERE id=@id`,{id})).recordset[0]);}
 async list(entity,{page=1,limit=50,asOf}={}){
  const t=table(entity);const fields=entity==='properties'?`e.*,(SELECT COUNT(*) FROM dbo.Units u WHERE u.property_id=e.id) total_units`:entity==='units'?`e.*,CASE WHEN EXISTS(SELECT 1 FROM dbo.Leases l WHERE l.unit_id=e.id AND l.status<>'cancelled' AND @asOf BETWEEN l.start_date AND l.end_date) THEN 'occupied' ELSE 'vacant' END status`:entity==='charges'?`e.*,e.amount_paise-COALESCE((SELECT SUM(r.amount_paise) FROM dbo.PaymentReceipts r WHERE r.charge_id=e.id AND r.paid_date<=@asOf),0) balance_paise`: 'e.*';
  const result=await query(this.pool,`SELECT ${fields} FROM ${t} e ORDER BY e.id OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY; SELECT COUNT(*) total FROM ${t};`,{offset:(page-1)*limit,limit,asOf});
  const items=result.recordsets[0].map(normalize);
  if(entity==='charges')for(const row of items)row.status=Number(row.balance_paise)<=0?'paid':row.due_date<asOf?'late':'pending';
  return {items,total:result.recordsets[1][0].total,page,limit};
 }
 async report(name,asOf){if(!reports[name])fail('Report not found',404);return (await query(this.pool,reports[name],{asOf})).recordset.map(normalize);}
 async kpis(asOf){
  // One SQL statement keeps all four KPI definitions together.
  const row=(await query(this.pool,`SELECT
  (SELECT COUNT(*) FROM dbo.Units WHERE available_from<=@asOf) total_units,
  (SELECT COUNT(*) FROM dbo.Leases l JOIN dbo.Units u ON u.id=l.unit_id WHERE l.status<>'cancelled' AND @asOf BETWEEN l.start_date AND l.end_date AND u.available_from<=@asOf) occupied_units,
  (SELECT COALESCE(SUM(amount_paise),0) FROM dbo.PaymentReceipts WHERE paid_date BETWEEN DATEFROMPARTS(YEAR(@asOf),MONTH(@asOf),1) AND @asOf) collected_paise,
  (SELECT COUNT(*) FROM dbo.SupportTickets WHERE status<>'resolved') open_tickets,
  (SELECT COUNT(*) FROM dbo.RentCharges c WHERE c.due_date<@asOf AND c.amount_paise>COALESCE((SELECT SUM(amount_paise) FROM dbo.PaymentReceipts r WHERE r.charge_id=c.id AND r.paid_date<=@asOf),0)) overdue_count;`,{asOf})).recordset[0];
  return {...normalize(row),occupancy_pct:row.total_units?Math.round(row.occupied_units/row.total_units*10000)/100:0};
 }
 async audit(connection,actor,entity,id,action,before,after,ticketId=null){
  await query(connection,'INSERT dbo.AuditLog(actor_id,entity,entity_id,action,before_json,after_json,ticket_id) VALUES(@actor_id,@entity,@entity_id,@action,@before_json,@after_json,@ticket_id)',{actor_id:actor,entity,entity_id:id,action,before_json:before?JSON.stringify(before):null,after_json:after?JSON.stringify(after):null,ticket_id:ticketId});
 }
 async validateRelations(connection,entity,value){
  if(entity==='tickets'&&!await this.get(value.related_table,value.related_id,connection))fail('Related record does not exist',409);
  if(entity==='maintenance'){
   const r=await query(connection,`SELECT TOP(1) id FROM dbo.Leases WHERE unit_id=@unit_id AND tenant_id=@tenant_id AND status<>'cancelled' AND @created_date BETWEEN start_date AND end_date`,value);
   if(!r.recordset.length)fail('Tenant must hold a lease for this unit on the request date',409);
  }
 }
 async change(connection,entity,id,input,actor,ticketId=null){
  const before=id?await this.get(entity,id,connection):null;if(id&&!before)fail('Record not found',404);
  const patch=parseRecord(entity,input,!!id);
  const merged=id?Object.fromEntries(Object.keys(models[entity].fields).map(k=>[k,k in patch?patch[k]:before[k]])):patch;
  const valid=parseRecord(entity,merged);await this.validateRelations(connection,entity,valid);
  const value=id?patch:valid;
  if(entity==='tickets'){
   if(valid.status==='resolved'&&!valid.resolution_notes?.trim())fail('Resolution notes are required');
   value.resolved_date=valid.status==='resolved'?new Date():null;
   if(!id)value.raised_by=actor;
  }
  const keys=Object.keys(value);
  if(id){await query(connection,`UPDATE ${table(entity)} SET ${keys.map(k=>`[${k}]=@${k}`).join(',')} WHERE id=@id`,{...value,id});}
  else{
   // OUTPUT INSERTED is incompatible with enabled AFTER triggers unless INTO is
   // used. SCOPE_IDENTITY in this batch returns the identity of our own insert.
   id=(await query(connection,`INSERT ${table(entity)}(${keys.map(k=>`[${k}]`).join(',')}) VALUES(${keys.map(k=>'@'+k).join(',')}); SELECT CAST(SCOPE_IDENTITY() AS int) id;`,value)).recordset[0].id;
  }
  const after=await this.get(entity,id,connection);await this.audit(connection,actor,entity,id,before?'update':'create',before,after,ticketId);return after;
 }
 async create(entity,input,actor){return transaction(this.pool,tx=>this.change(tx,entity,null,input,actor));}
 async update(entity,id,input,actor){return transaction(this.pool,tx=>this.change(tx,entity,id,input,actor));}
 async remove(entity,id,actor){return transaction(this.pool,async tx=>{
  const before=await this.get(entity,id,tx);if(!before)fail('Record not found',404);
  const refs=await query(tx,'SELECT TOP(1) id FROM dbo.SupportTickets WHERE related_table=@entity AND related_id=@id',{entity,id});
  if(refs.recordset.length)fail('A support ticket references this record; retain it for investigation',409);
  await query(tx,`DELETE FROM ${table(entity)} WHERE id=@id`,{id});await this.audit(tx,actor,entity,id,'delete',before,null);return {ok:true};
 });}
 async investigate(id,actor){return transaction(this.pool,async tx=>{
  const ticket=await this.get('tickets',id,tx);if(!ticket)fail('Ticket not found',404);
  const record=await this.get(ticket.related_table,ticket.related_id,tx);
  // Allowlisted diagnostics only. There is no arbitrary SQL execution endpoint.
  let financial=[];
  if(ticket.related_table==='units')financial=(await query(tx,`SELECT l.id lease_id,l.monthly_rent_paise,u.rent_paise listed_rent_paise,l.start_date,l.end_date,l.status FROM dbo.Leases l JOIN dbo.Units u ON u.id=l.unit_id WHERE u.id=@id ORDER BY l.start_date`,{id:ticket.related_id})).recordset;
  else if(ticket.related_table==='charges'||ticket.related_table==='receipts')financial=(await query(tx,`SELECT c.id charge_id,c.amount_paise billed_paise,COALESCE(SUM(r.amount_paise),0) received_paise,c.amount_paise-COALESCE(SUM(r.amount_paise),0) balance_paise FROM dbo.RentCharges c LEFT JOIN dbo.PaymentReceipts r ON r.charge_id=c.id WHERE c.id=${ticket.related_table==='charges'?'@id':'(SELECT charge_id FROM dbo.PaymentReceipts WHERE id=@id)'} GROUP BY c.id,c.amount_paise`,{id:ticket.related_id})).recordset;
  const history=(await query(tx,'SELECT id,actor_id,action,before_json,after_json,created_date FROM dbo.AuditLog WHERE entity=@entity AND entity_id=@id ORDER BY id DESC',{entity:ticket.related_table,id:ticket.related_id})).recordset;
  if(ticket.status!=='resolved')await this.change(tx,'tickets',id,{status:'investigating'},actor);
  return {ticket_id:id,record,financial:financial.map(normalize),history,note:'Listed rent can legitimately differ from contracted rent. Verify the agreement before correcting data.'};
 });}
 async resolve(id,notes,correction,actor){return transaction(this.pool,async tx=>{
  const ticket=await this.get('tickets',id,tx);if(!ticket)fail('Ticket not found',404);if(ticket.status==='resolved')fail('Ticket is already resolved',409);
  if(correction)await this.change(tx,ticket.related_table,ticket.related_id,correction,actor,id);
  return this.change(tx,'tickets',id,{status:'resolved',resolution_notes:notes},actor);
 });}
 async auditList(){return (await query(this.pool,'SELECT TOP(200) a.*,u.name actor FROM dbo.AuditLog a JOIN dbo.Users u ON u.id=a.actor_id ORDER BY a.id DESC')).recordset;}
}
