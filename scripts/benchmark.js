import {mkdir,writeFile} from 'node:fs/promises';
import {connect,sql} from '../server/database.js';
// An isolated database avoids changing application indexes or flushing shared caches.
const base=process.env.TEST_DB_NAME;
if(!base||!/^\w+_test$/.test(base))throw new Error('Set TEST_DB_NAME ending in _test');
const name=`${base}_bench_${Date.now()}`;
const master=await connect('master');let pool;
try{
 await master.request().query(`CREATE DATABASE [${name}]`);pool=await connect(name);
 await pool.request().query(`CREATE TABLE dbo.BenchmarkReceipts(id int PRIMARY KEY,charge_id int NOT NULL,paid_date date NOT NULL,amount_paise bigint NOT NULL);
 WITH digit(n) AS (SELECT n FROM (VALUES(0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) d(n)),
 nums AS (SELECT TOP(200000) ROW_NUMBER() OVER(ORDER BY (SELECT NULL)) n FROM digit a CROSS JOIN digit b CROSS JOIN digit c CROSS JOIN digit d CROSS JOIN digit e CROSS JOIN digit f)
 INSERT dbo.BenchmarkReceipts SELECT n,1+n%10000,DATEADD(day,n%365,'2025-01-01'),1750000 FROM nums;`);
 const results={rows:200000,query:'SUM(amount_paise) WHERE charge_id=42 AND paid_date<=2025-12-31',before:[],after:[]};
 await mkdir('benchmark-output',{recursive:true});
 for(const phase of ['before','after']){
  if(phase==='after')await pool.request().query('CREATE INDEX IX_Benchmark_ChargeDate ON dbo.BenchmarkReceipts(charge_id,paid_date) INCLUDE(amount_paise)');
  for(let run=0;run<4;run++){
   const messages=[];const request=new sql.Request(pool);request.on('info',m=>messages.push(m.message));
   const start=performance.now();
   const response=await request.query("SET STATISTICS IO ON; SET STATISTICS TIME ON; SET STATISTICS XML ON; SELECT SUM(amount_paise) total_paise FROM dbo.BenchmarkReceipts WHERE charge_id=42 AND paid_date<='2025-12-31'; SET STATISTICS XML OFF; SET STATISTICS IO OFF; SET STATISTICS TIME OFF;");
   const elapsed_ms=performance.now()-start;
   if(run>0)results[phase].push({run,elapsed_ms,messages}); // First run warms that plan.
   for(const rows of response.recordsets)for(const row of rows)for(const value of Object.values(row))if(typeof value==='string'&&value.includes('ShowPlanXML'))await writeFile(`benchmark-output/${phase}-plan.sqlplan`,value);
  }
 }
 await writeFile('benchmark-output/results.json',JSON.stringify(results,null,2));
 console.log('Measured results and actual plans saved in benchmark-output. Compare logical reads, not only elapsed time.');
}finally{
 if(pool)await pool.close();
 // Only the uniquely named database created by this process is removed.
 await master.request().query(`IF DB_ID(N'${name}') IS NOT NULL BEGIN ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}]; END`);
 await master.close();
}
