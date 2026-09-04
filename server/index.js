import {connect} from './database.js';
import {Repository} from './repository.js';
import {createApp} from './app.js';
const pool=await connect();
const app=createApp(new Repository(pool),{secret:process.env.JWT_SECRET,demoMode:process.env.DEMO_MODE==='true'});
const server=app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('PropertyPulse API and dashboard listening on port '+(process.env.PORT||3000)));
async function close(){server.close(async()=>{await pool.close();process.exit(0)});}
process.on('SIGINT',close);process.on('SIGTERM',close);
