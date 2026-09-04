import {z} from 'zod';
import {businessDate,isDate} from './domain.js';
const date=z.string().refine(isDate,'Use a real date in YYYY-MM-DD format');
const text=(n=100)=>z.string().trim().min(1).max(n);
const id=z.number().int().positive();
const money=z.number().int().positive().max(9999999999);
const email=z.string().trim().email().max(200).transform(x=>x.toLowerCase());
export const reportDate=date;
// Only this internal map supplies SQL identifiers. Request strings never become table names.
export const models={
 properties:{table:'Properties',fields:{name:text(),address:text(250),city:text(),created_date:date}},
 units:{table:'Units',fields:{property_id:id,unit_number:text(30).transform(x=>x.toUpperCase()),rent_paise:money,available_from:date}},
 tenants:{table:'Tenants',fields:{name:text(),email,phone:text(25)}},
 leases:{table:'Leases',fields:{tenant_id:id,unit_id:id,start_date:date,end_date:date,monthly_rent_paise:money,status:z.enum(['active','ended','cancelled'])}},
 charges:{table:'RentCharges',fields:{lease_id:id,amount_paise:money,due_date:date,description:text(150)}},
 receipts:{table:'PaymentReceipts',fields:{charge_id:id,amount_paise:money,paid_date:date.refine(x=>x<=businessDate(),'Receipt date cannot be in the future'),reference:text().transform(x=>x.toUpperCase()),method:z.enum(['UPI','Bank transfer','Cash'])}},
 maintenance:{table:'MaintenanceRequests',fields:{unit_id:id,tenant_id:id,issue:text(1000),priority:z.enum(['low','medium','high','urgent']),status:z.enum(['open','in_progress','resolved']),created_date:date,resolved_date:date.nullable()}},
 tickets:{table:'SupportTickets',fields:{description:text(1000),related_table:z.enum(['properties','units','tenants','leases','charges','receipts','maintenance']),related_id:id,status:z.enum(['open','investigating','resolved']),resolution_notes:text(2000).nullable()}}
};
export function parseRecord(entity,input,partial=false){
 const m=models[entity];if(!m)throw new Error('Unknown entity');
 let schema=z.object(m.fields).strict();if(partial)schema=schema.partial();
 const value=schema.parse(input);
 if(!Object.keys(value).length)throw Object.assign(new Error('Supply at least one field'),{status:400});
 if(entity==='leases'&&value.start_date&&value.end_date&&value.end_date<value.start_date)throw Object.assign(new Error('Lease end must follow its start'),{status:400});
 if(entity==='maintenance'&&value.created_date&&value.resolved_date&&value.resolved_date<value.created_date)throw Object.assign(new Error('Resolution cannot precede creation'),{status:400});
 return value;
}
