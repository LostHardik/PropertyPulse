import {buildSeed} from '../scripts/seed-data.js';
import {marketSnapshot} from '../data/nhb-residex-march-2026.js';

const users=[
 {id:1,name:'Portfolio Admin',email:'admin@propertypulse.example',role:'admin',active:true},
 {id:2,name:'Portfolio Viewer',email:'viewer@propertypulse.example',role:'viewer',active:true}
];

function fail(message,status=404){throw Object.assign(new Error(message),{status});}

export function createDemoRepository(){
 const data=buildSeed();
 const audit=[];
 const months=Array.from({length:12},(_,index)=>{
  const month=index<3?index+10:index-2;
  return `${index<3?2025:2026}-${String(month).padStart(2,'0')}`;
 });
 const propertyNames=data.properties.map(row=>row.name);
 const recordAudit=(actor,entity,id,action,before,after,ticket_id=null)=>audit.unshift({
  id:audit.length+1,actor_id:actor,entity,entity_id:id,action,
  before_json:before?JSON.stringify(before):null,after_json:after?JSON.stringify(after):null,
  ticket_id,created_date:new Date().toISOString()
 });

 const reports={
  'rent-roll':()=>data.units.slice(0,12).map((unit,index)=>({
   property:data.properties.find(p=>p.id===unit.property_id).name,unit_number:unit.unit_number,
   tenant:index%5===4?null:data.tenants[index]?.name,listed_rent_paise:unit.rent_paise,
   contracted_rent_paise:index%5===4?null:unit.rent_paise,status:index%5===4?'vacant':'occupied'
  })),
  overdue:()=>data.charges.slice(0,8).map((charge,index)=>({
   charge_id:charge.id,property:propertyNames[index%propertyNames.length],unit_number:data.units[index].unit_number,
   tenant:data.tenants[index].name,due_date:charge.due_date,balance_paise:Math.round(charge.amount_paise/(index%3+1)),
   days_overdue:30+index*4,severity_rank:index+1
  })),
  occupancy:()=>months.flatMap((month,monthIndex)=>propertyNames.map((property,propertyIndex)=>({
   property_id:propertyIndex+1,property,month,snapshot_date:`${month}-${month==='2026-09'?'04':'28'}`,
   total_units:10,occupied_units:Math.max(6,9-((monthIndex+propertyIndex)%4)),
   occupancy_pct:Math.max(60,90-((monthIndex+propertyIndex)%4)*10)
  }))),
  expiry:()=>data.leases.slice(0,3).map((lease,index)=>({
   lease_id:lease.id,property:propertyNames[0],unit_number:data.units[index].unit_number,
   tenant:data.tenants[index].name,end_date:lease.end_date,days_remaining:16+index*30,
   horizon:['0-30 days','31-60 days','61-90 days'][index]
  })),
  maintenance:()=>propertyNames.map((property,index)=>({
   property_id:index+1,property,resolved_count:6,avg_days:(index+1)*2,portfolio_avg_days:5,above_average:index>1
  })),
  collection:()=>months.map((month,index)=>({
   month,collected_paise:42000000+index*275000,running_total_paise:(index+1)*43500000
  }))
 };

 return {
  async userByEmail(email){return users.find(user=>user.email===email);},
  async userByRole(role){return users.find(user=>user.role===role&&user.active);},
  async userById(id){return users.find(user=>user.id===id);},
  async marketBenchmarks(){return {...marketSnapshot,rows:marketSnapshot.rows.map(row=>({...row,quarter_end:marketSnapshot.quarter_end}))};},
  async kpis(){
   return {total_units:data.units.length,occupied_units:32,collected_paise:44925000,
    open_tickets:data.tickets.filter(ticket=>ticket.status!=='resolved').length,overdue_count:138,occupancy_pct:80};
  },
  async report(name){return reports[name]?.()??fail('Report not found');},
  async list(entity,{page=1,limit=25}){
   const rows=data[entity]??fail('Entity not found');const start=(page-1)*limit;
   return {items:rows.slice(start,start+limit),total:rows.length,page,limit};
  },
  async get(entity,id){return (data[entity]??[]).find(row=>row.id===id)??null;},
  async create(entity,input,actor){
   const rows=data[entity]??fail('Entity not found');const row={id:Math.max(0,...rows.map(item=>item.id))+1,...input};
   rows.push(row);recordAudit(actor,entity,row.id,'create',null,row);return row;
  },
  async update(entity,id,input,actor){
   const row=(data[entity]??[]).find(item=>item.id===id)??fail('Record not found');const before={...row};
   Object.assign(row,input);recordAudit(actor,entity,id,'update',before,row);return row;
  },
  async remove(entity,id,actor){
   const rows=data[entity]??fail('Entity not found');const index=rows.findIndex(row=>row.id===id);
   if(index<0)fail('Record not found');const [before]=rows.splice(index,1);recordAudit(actor,entity,id,'delete',before,null);return {ok:true};
  },
  async auditList(){return audit.slice(0,200);},
  async investigate(id){
   const ticket=data.tickets.find(row=>row.id===id)??fail('Ticket not found');
   ticket.status=ticket.status==='resolved'?'resolved':'investigating';
   const record=(data[ticket.related_table]??[]).find(row=>row.id===ticket.related_id)??null;
   return {ticket_id:id,record,
    financial:ticket.related_table==='units'&&record?[{lease_id:id,monthly_rent_paise:record.rent_paise,listed_rent_paise:record.rent_paise,status:'active'}]:[],
    history:audit.filter(row=>row.entity===ticket.related_table&&row.entity_id===ticket.related_id),
    note:'Listed rent can legitimately differ from contracted rent. Verify the agreement before correcting data.'};
  },
  async resolve(id,notes,correction,actor){
   const ticket=data.tickets.find(row=>row.id===id)??fail('Ticket not found');
   if(correction){
    const record=(data[ticket.related_table]??[]).find(row=>row.id===ticket.related_id)??fail('Related record not found');
    const before={...record};Object.assign(record,correction);recordAudit(actor,ticket.related_table,record.id,'ticket-correction',before,record,id);
   }
   const before={...ticket};ticket.status='resolved';ticket.resolution_notes=notes;ticket.resolved_date=new Date().toISOString();
   recordAudit(actor,'tickets',id,'resolve',before,ticket,id);return ticket;
  }
 };
}
