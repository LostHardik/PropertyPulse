import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';

let server,base,adminToken,viewerToken;
const call=(path,{token,method='GET',body}={})=>fetch(base+'/api'+path,{
 method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},
 ...(body?{body:JSON.stringify(body)}:{})
});

before(async()=>{
 process.env.JWT_SECRET='vercel-demo-test-secret-with-more-than-thirty-two-characters';
 const {default:app}=await import('../index.js');
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 base=`http://127.0.0.1:${server.address().port}`;
 for(const role of ['admin','viewer']){
  const response=await call('/auth/demo',{method:'POST',body:{role}});assert.equal(response.status,200);
  const {token}=await response.json();if(role==='admin')adminToken=token;else viewerToken=token;
 }
});
after(()=>new Promise(resolve=>server.close(resolve)));

test('Vercel entry serves attributed real market facts',async()=>{
 const response=await call('/market-benchmarks',{token:viewerToken});assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.publisher,'National Housing Bank');
 assert.equal(body.rows.find(row=>row.city==='Pune').annual_change_pct,2.9);
});

test('Vercel demo exposes anonymized operations in real neighbourhoods',async()=>{
 const properties=await (await call('/entities/properties?asOf=2026-09-04&page=1&limit=25',{token:viewerToken})).json();
 assert.equal(properties.items[0].address,'Kharadi');
 const tenants=await (await call('/entities/tenants?asOf=2026-09-04&page=1&limit=25',{token:viewerToken})).json();
 assert.match(tenants.items[0].name,/^Tenant \d{3}$/);assert.match(tenants.items[0].email,/@example\.invalid$/);
});

test('Vercel administrator changes resettable demo data while viewer writes remain blocked',async()=>{
 const created=await call('/entities/properties',{token:adminToken,method:'POST',body:{name:'Recruiter Sandbox',address:'Viman Nagar',city:'Pune',created_date:'2026-09-04'}});
 assert.equal(created.status,201);const row=await created.json();assert.equal(row.name,'Recruiter Sandbox');
 const denied=await call('/entities/properties',{token:viewerToken,method:'POST',body:{name:'Blocked',address:'Baner',city:'Pune',created_date:'2026-09-04'}});
 assert.equal(denied.status,403);
});
