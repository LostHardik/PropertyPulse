export const AS_OF='2026-09-04';
export function isDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
export function businessDate(now=new Date(),timeZone=process.env.BUSINESS_TIME_ZONE||'Asia/Kolkata'){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
}
export function moneyToPaise(value){
 if(typeof value!=='string'||!/^\d{1,8}(\.\d{1,2})?$/.test(value))throw new Error('Use a positive INR amount with at most two decimals');
 const [whole,fraction='']=value.split('.');const n=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(n<=0)throw new Error('Amount must be positive');return n;
}
export function overlap(a,b){return a.status!=='cancelled'&&b.status!=='cancelled'&&a.unit_id===b.unit_id&&a.start_date<=b.end_date&&b.start_date<=a.end_date;}
export function paymentStatus(due,amount,received,asOf){return received>=amount?'paid':due<asOf?'late':'pending';}
export function safeError(error){
 const n=error.number??error.originalError?.info?.number;
 if([2601,2627,547,1205,1222].includes(n)||n>=51000&&n<51100)return {status:409,message:n>=51000?error.message:'This change conflicts with related records, uniqueness rules or another write. Refresh and retry.'};
 return {status:500,message:'The request could not be completed. Check the server log using the request ID.'};
}
