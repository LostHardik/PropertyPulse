import bcrypt from 'bcryptjs';
import {pathToFileURL} from 'node:url';
import {buildSeed} from './seed-data.js';
import {connect,query,transaction} from '../server/database.js';
import {models} from '../server/models.js';
import {marketSnapshot} from '../data/nhb-residex-march-2026.js';
export async function seed(pool,{adminPassword,viewerPassword,adminEmail='admin@propertypulse.example',viewerEmail='viewer@propertypulse.example'}={}){
 for(const pass of [adminPassword,viewerPassword])if(!pass||pass.length<12||pass.startsWith('REPLACE_'))throw new Error('Set admin/viewer passwords of at least 12 characters');
 const hashes=await Promise.all([adminPassword,viewerPassword].map(p=>bcrypt.hash(p,12)));
 return transaction(pool,async tx=>{
  if((await query(tx,'SELECT COUNT(*) n FROM dbo.Users')).recordset[0].n)throw new Error('Seed requires an empty database. Existing data has not been changed.');
  await query(tx,'SET IDENTITY_INSERT dbo.Users ON; INSERT dbo.Users(id,name,email,password_hash,role) VALUES(1,\'Portfolio Admin\',@adminEmail,@adminHash,\'admin\'),(2,\'Portfolio Viewer\',@viewerEmail,@viewerHash,\'viewer\'); SET IDENTITY_INSERT dbo.Users OFF;',{adminEmail:adminEmail.toLowerCase(),viewerEmail:viewerEmail.toLowerCase(),adminHash:hashes[0],viewerHash:hashes[1]});
  const data=buildSeed();
  for(const [entity,rows] of Object.entries(data)){
   const t=`dbo.[${models[entity].table}]`;await query(tx,`SET IDENTITY_INSERT ${t} ON;`);
   for(const row of rows){const keys=Object.keys(row);await query(tx,`INSERT ${t}(${keys.map(k=>'['+k+']').join(',')}) VALUES(${keys.map(k=>'@'+k).join(',')});`,row);}
   await query(tx,`SET IDENTITY_INSERT ${t} OFF;`);
  }
  for(const row of marketSnapshot.rows)await query(tx,'INSERT dbo.MarketBenchmarks(city,quarter_end,annual_change_pct,is_composite) VALUES(@city,@quarter_end,@annual_change_pct,@is_composite)',{city:row.city,quarter_end:marketSnapshot.quarter_end,annual_change_pct:row.annual_change_pct,is_composite:Boolean(row.composite)});
  return {...Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length])),market_benchmarks:marketSnapshot.rows.length};
 });
}
if(import.meta.url===pathToFileURL(process.argv[1]).href){const pool=await connect();try{console.log(await seed(pool,{adminPassword:process.env.ADMIN_PASSWORD,viewerPassword:process.env.VIEWER_PASSWORD,adminEmail:process.env.ADMIN_EMAIL,viewerEmail:process.env.VIEWER_EMAIL}));}finally{await pool.close();}}
