// Vercel entry point: a resettable, privacy-safe portfolio demo. The full
// SQL Server application continues to run through server/index.js.
import {createApp} from './server/app.js';
import {createDemoRepository} from './server/demo-repository.js';

export default createApp(createDemoRepository(),{
 secret:process.env.JWT_SECRET,
 staticFiles:false,
 logging:true,
 demoMode:true
});
