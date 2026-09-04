import {readdir,readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {connect,query,transaction} from '../server/database.js';
export async function migrate(pool){
 await query(pool,"IF OBJECT_ID('dbo.SchemaMigrations') IS NULL CREATE TABLE dbo.SchemaMigrations(name nvarchar(200) PRIMARY KEY,applied_at datetime2 DEFAULT SYSUTCDATETIME());");
 const dir=new URL('../db/migrations/',import.meta.url);
 for(const name of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort()){
  await transaction(pool,async tx=>{
   if((await query(tx,'SELECT name FROM dbo.SchemaMigrations WHERE name=@name',{name})).recordset.length)return;
   const source=await readFile(new URL(name,dir),'utf8');
   for(const batch of source.split(/^GO\s*$/mi).map(s=>s.trim()).filter(Boolean))await query(tx,batch);
   await query(tx,'INSERT dbo.SchemaMigrations(name) VALUES(@name)',{name});console.log('Applied '+name);
  });
 }
}
if(import.meta.url===pathToFileURL(process.argv[1]).href){
 const name=process.env.DB_NAME||'PropertyPulse';if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name))throw new Error('Invalid database name');
 const master=await connect('master');try{await query(master,`IF DB_ID(N'${name}') IS NULL CREATE DATABASE [${name}];`);}finally{await master.close();}
 const pool=await connect(name);try{await migrate(pool);}finally{await pool.close();}
}
