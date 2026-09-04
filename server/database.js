import sql from 'mssql';
export {sql};
export function config(database=process.env.DB_NAME||'PropertyPulse'){
 return {server:process.env.DB_HOST||'localhost',port:Number(process.env.DB_PORT||1433),database,
 user:process.env.DB_USER||'sa',password:process.env.DB_PASSWORD,
 options:{encrypt:process.env.DB_ENCRYPT!=='false',trustServerCertificate:process.env.DB_TRUST_CERT==='true',useUTC:true},
 pool:{max:10,min:0,idleTimeoutMillis:30000},requestTimeout:30000,connectionTimeout:10000};
}
export async function connect(database){return new sql.ConnectionPool(config(database)).connect();}
export function bind(request,values={}){
 for(const [key,value] of Object.entries(values)){
  if(value instanceof Date)request.input(key,sql.DateTime2,value);
  else if(key==='asOf'||key.endsWith('_date')||key==='available_from')request.input(key,sql.Date,value);
  else if(key.endsWith('_paise'))request.input(key,sql.BigInt,value);
  else if(key.endsWith('_pct'))request.input(key,sql.Decimal(6,2),value);
  else if(typeof value==='number')request.input(key,sql.Int,value);
  else if(typeof value==='boolean')request.input(key,sql.Bit,value);
  else request.input(key,sql.NVarChar(sql.MAX),value);
 }return request;
}
export async function transaction(pool,fn){
 const tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
 try{
  await new sql.Request(tx).query("DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource='PropertyPulseLedger',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; IF @r<0 THROW 51000,'Ledger is busy. Retry.',1;");
  const result=await fn(tx);await tx.commit();return result;
 }catch(e){try{await tx.rollback()}catch{}throw e;}
}
export function query(connection,text,params={}){return bind(new sql.Request(connection),params).query(text);}
