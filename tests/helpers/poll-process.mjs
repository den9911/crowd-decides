import {readdir} from 'node:fs/promises';
import {createApp} from '../../server/index.mjs';
const [dataDir,phase]=process.argv.slice(2),app=await createApp({dataDir,disableRateLimit:true});
if(phase==='fail-close')app.db.exec("CREATE TRIGGER fail_close BEFORE UPDATE OF closed ON polls BEGIN SELECT RAISE(ABORT,'write refused'); END");
if(phase==='lose-close-response')app.server.on('request',(req,res)=>{if(req.url==='/api/poll/close'&&req.method==='POST')res.end=function(){process.send({type:'committed'});return this;};});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));process.send({type:'ready',port:app.server.address().port});
process.on('message',message=>{if(message==='allow-close'){app.db.exec('DROP TRIGGER fail_close');process.send({type:'allowed'});}if(message==='stats')app.server.getConnections(async(error,connections)=>process.send({type:'stats',connections,fd:process.platform==='linux'?(await readdir('/proc/self/fd')).length:null}));if(message==='stop')app.server.close(()=>process.disconnect());});
