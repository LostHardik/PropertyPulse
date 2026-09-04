// Deterministic fictional operations calibrated for an Indian portfolio.
// Locations are real neighbourhood names; properties and people are not real.
export const seedAsOf='2026-09-04';
export function buildSeed(){
 const data={properties:[],units:[],tenants:[],leases:[],charges:[],receipts:[],maintenance:[],tickets:[]};
 let leaseId=0,tenantId=0,chargeId=0,receiptId=0;
 const buildings=[
  {name:'Aster Residency',address:'Kharadi',city:'Pune'},
  {name:'Riverstone Court',address:'Baner',city:'Pune'},
  {name:'Orchid Business Park',address:'Andheri East',city:'Mumbai'},
  {name:'Sahyadri Heights',address:'Hinjawadi',city:'Pune'}
 ];
 for(let p=1;p<=4;p++){
  const building=buildings[p-1];
  data.properties.push({id:p,name:building.name,address:building.address,city:building.city,created_date:'2025-01-01'});
  for(let n=1;n<=10;n++){
   const unitId=(p-1)*10+n,rent=(15000+p*2000+n*500)*100;
   data.units.push({id:unitId,property_id:p,unit_number:`${String.fromCharCode(64+p)}-${n}`,rent_paise:rent,available_from:'2025-01-01'});
   if(n===10)continue;
   tenantId++;leaseId++;
   data.tenants.push({id:tenantId,name:`Tenant ${String(tenantId).padStart(3,'0')}`,email:`tenant-${String(tenantId).padStart(3,'0')}@example.invalid`,phone:`ANON-${String(tenantId).padStart(3,'0')}`});
   const end=n===9?'2026-06-30':p===1&&n<=3?['2026-09-20','2026-10-20','2026-11-20'][n-1]:'2027-09-30';
   data.leases.push({id:leaseId,tenant_id:tenantId,unit_id:unitId,start_date:'2025-10-01',end_date:end,monthly_rent_paise:rent,status:n===9?'ended':'active'});
   for(let m=0;m<12;m++){
    const due=new Date(Date.UTC(2025,9+m,1)).toISOString().slice(0,10);if(due>end)continue;
    chargeId++;data.charges.push({id:chargeId,lease_id:leaseId,amount_paise:rent,due_date:due,description:`Rent ${due.slice(0,7)}`});
    if(chargeId%7===0)continue;
    const late=chargeId%4===0,paid=new Date(Date.parse(due+'T00:00:00Z')+(late?12:1)*86400000).toISOString().slice(0,10);
    if(paid>seedAsOf)continue;
    const partial=chargeId%5===0;
    data.receipts.push({id:++receiptId,charge_id:chargeId,amount_paise:partial?rent/2:rent,paid_date:paid,reference:`SEED-${receiptId}`,method:late?'Bank transfer':'UPI'});
    // Every eleventh eligible non-partial bill is split into two actual receipts.
    if(chargeId%11===0&&!partial){data.receipts.at(-1).amount_paise=rent/2;data.receipts.push({id:++receiptId,charge_id:chargeId,amount_paise:rent/2,paid_date:paid,reference:`SEED-${receiptId}`,method:'UPI'});}
   }
  }
  for(let n=1;n<=8;n++){
   const created=`2026-08-${String(n).padStart(2,'0')}`,resolved=n<=6?new Date(Date.parse(created+'T00:00:00Z')+p*2*86400000).toISOString().slice(0,10):null;
   data.maintenance.push({id:(p-1)*8+n,unit_id:(p-1)*10+n,tenant_id:(p-1)*9+n,issue:['Leaking tap','Elevator noise','Air conditioner service','Door lock repair'][n%4],priority:n===8?'urgent':n%2?'medium':'low',status:resolved?'resolved':'open',created_date:created,resolved_date:resolved});
  }
 }
 for(let n=1;n<=8;n++)data.tickets.push({id:n,raised_by:1,description:`Please verify the listed rent for unit ${n}; it may differ from the agreement.`,related_table:'units',related_id:n,status:'open',resolution_notes:null,created_date:'2026-09-01',resolved_date:null});
 return data;
}
