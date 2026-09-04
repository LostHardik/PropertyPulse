import express from 'express';
import helmet from 'helmet';
import {rateLimit} from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {z,ZodError} from 'zod';
import {models,parseRecord,reportDate} from './models.js';
import {businessDate,safeError} from './domain.js';
import {excel,pdf} from './exports.js';
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const positive=z.coerce.number().int().positive();
export function createApp(repo,{secret,staticFiles=true,logging=true,demoMode=false}={}){
 if(!secret||secret.length<32||secret.includes('REPLACE_'))throw new Error('Set a random JWT_SECRET of at least 32 characters');
 const app=express();app.disable('x-powered-by');app.use(helmet());app.use(express.json({limit:'32kb'}));
 app.use((req,res,next)=>{req.requestId=randomUUID();res.setHeader('X-Request-ID',req.requestId);res.setHeader('Cache-Control','no-store');next();});
 app.get('/api/health',(_,res)=>res.json({ok:true,service:'PropertyPulse'}));
 const session=user=>({
  token:jwt.sign({sub:String(user.id)},secret,{algorithm:'HS256',expiresIn:'1h',issuer:'propertypulse',audience:'propertypulse-web'}),
  user:{id:user.id,name:user.name,email:user.email,role:user.role}
 });
 app.post('/api/auth/login',rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-7',legacyHeaders:false}),wrap(async(req,res)=>{
  const data=z.object({email:z.string().trim().email().transform(s=>s.toLowerCase()),password:z.string().min(1).max(200)}).strict().parse(req.body);
  const user=await repo.userByEmail(data.email);
  // Perform a hash comparison even for unknown accounts to reduce obvious timing differences.
  const ok=await bcrypt.compare(data.password,user?.password_hash||'$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW');
  if(!ok||!user?.active)return res.status(401).json({error:'Invalid email or password'});
  res.json(session(user));
 }));
 if(demoMode)app.post('/api/auth/demo',rateLimit({windowMs:15*60*1000,limit:60,standardHeaders:'draft-7',legacyHeaders:false}),wrap(async(req,res)=>{
  const {role}=z.object({role:z.enum(['admin','viewer'])}).strict().parse(req.body);
  const user=await repo.userByRole(role);
  if(!user?.active)return res.status(404).json({error:'Demo role is unavailable'});
  res.json(session(user));
 }));
 app.use('/api',wrap(async(req,res,next)=>{
  const header=req.headers.authorization;if(!header?.startsWith('Bearer '))return res.status(401).json({error:'Sign in required'});
  let payload;try{payload=jwt.verify(header.slice(7),secret,{algorithms:['HS256'],issuer:'propertypulse',audience:'propertypulse-web'});}catch{return res.status(401).json({error:'Session expired or invalid'});}
  if(!/^\d+$/.test(String(payload.sub)))return res.status(401).json({error:'Invalid session'});
  req.user=await repo.userById(Number(payload.sub));if(!req.user?.active)return res.status(401).json({error:'Account unavailable'});next();
 }));
 const admin=(req,res,next)=>req.user.role==='admin'?next():res.status(403).json({error:'Administrator access required'});
 const asOf=req=>reportDate.parse(req.query.asOf||businessDate());
 app.get('/api/auth/me',(req,res)=>res.json(req.user));
 app.get('/api/market-benchmarks',wrap(async(req,res)=>res.json(await repo.marketBenchmarks())));
 app.get('/api/kpis',wrap(async(req,res)=>res.json(await repo.kpis(asOf(req)))));
 app.get('/api/reports/:name/export',wrap(async(req,res)=>{
  const date=asOf(req),format=z.enum(['pdf','xlsx']).parse(req.query.format),rows=await repo.report(req.params.name,date);
  const buffer=format==='xlsx'?await excel(rows,req.params.name,date):await pdf(rows,req.params.name,date);
  res.type(format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename="propertypulse-${req.params.name}-${date}.${format}"`);res.send(buffer);
 }));
 app.get('/api/reports/:name',wrap(async(req,res)=>res.json(await repo.report(req.params.name,asOf(req)))));
 app.get('/api/audit',admin,wrap(async(req,res)=>res.json(await repo.auditList())));
 app.post('/api/tickets/:id/investigate',admin,wrap(async(req,res)=>res.json(await repo.investigate(positive.parse(req.params.id),req.user.id))));
 app.post('/api/tickets/:id/resolve',admin,wrap(async(req,res)=>{
  const v=z.object({resolution_notes:z.string().trim().min(5).max(2000),correction:z.record(z.unknown()).optional()}).strict().parse(req.body);
  res.json(await repo.resolve(positive.parse(req.params.id),v.resolution_notes,v.correction,req.user.id));
 }));
 app.param('entity',(req,res,next,entity)=>Object.hasOwn(models,entity)?next():res.status(404).json({error:'Entity not found'}));
 app.get('/api/entities/:entity',wrap(async(req,res)=>res.json(await repo.list(req.params.entity,{page:positive.parse(req.query.page||1),limit:positive.max(200).parse(req.query.limit||50),asOf:asOf(req)}))));
 app.get('/api/entities/:entity/:id',wrap(async(req,res)=>{const row=await repo.get(req.params.entity,positive.parse(req.params.id));if(!row)return res.status(404).json({error:'Record not found'});res.json(row);}));
 app.post('/api/entities/:entity',admin,wrap(async(req,res)=>{parseRecord(req.params.entity,req.body);res.status(201).json(await repo.create(req.params.entity,req.body,req.user.id));}));
 app.patch('/api/entities/:entity/:id',admin,wrap(async(req,res)=>{parseRecord(req.params.entity,req.body,true);res.json(await repo.update(req.params.entity,positive.parse(req.params.id),req.body,req.user.id));}));
 app.delete('/api/entities/:entity/:id',admin,wrap(async(req,res)=>res.json(await repo.remove(req.params.entity,positive.parse(req.params.id),req.user.id))));
 app.use('/api',(_,res)=>res.status(404).json({error:'Endpoint not found'}));
 if(staticFiles){const dist=fileURLToPath(new URL('../dist/',import.meta.url));app.use(express.static(dist));app.get('*',(_,res)=>res.sendFile(dist+'index.html'));}
 app.use((err,req,res,next)=>{
  if(res.headersSent)return next(err);
  if(err instanceof ZodError)return res.status(400).json({error:err.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '),requestId:req.requestId});
  if(err.type==='entity.parse.failed')return res.status(400).json({error:'Invalid JSON'});
  if(err.type==='entity.too.large')return res.status(413).json({error:'Request too large'});
  if(err.status&&err.status>=400&&err.status<500)return res.status(err.status).json({error:err.message,requestId:req.requestId});
  if(logging)console.error(JSON.stringify({requestId:req.requestId,error:err.message,number:err.number}));
  const failure=safeError(err);res.status(failure.status).json({error:failure.message,requestId:req.requestId});
 });return app;
}
