const {app,utilityProcess}=require('electron'),fs=require('node:fs'),path=require('node:path');
const out=path.resolve('dist/direction-worker-smoke'),profile=path.join(out,'test-profile-'+process.pid);fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
app.whenReady().then(async()=>{
 const fixtures=require(path.join(out,'fixtures.cjs')).fixtures();
 async function check(name,file,payload,accept){
  const child=utilityProcess.fork(file,[],{stdio:'pipe',serviceName:'TFTBot decision regression'});let done=false;
  try{return await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{child.kill();reject(Error(name+' timed out'));},15000);
   child.on('exit',code=>{if(!done){clearTimeout(timer);reject(Error(name+' exited '+code));}});
   child.on('message',message=>{
    if(message.type==='result'&&accept(message.forecast)){
     done=true;clearTimeout(timer);fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(message.forecast,null,2));
     child.postMessage('stop');resolve({name,direction:message.forecast.direction.ready,phase:message.forecast.phase,strategy:message.forecast.strategy?.ready});
    }
   });
   child.postMessage({type:'evaluate',id:1,...payload});
  });}finally{if(!done)child.kill();}
 }
 try{
  if(!fixtures.full.request||!fixtures.full.strategy.ready)throw Error('Synthetic worker fixture is incomplete');
  const results=await Promise.all([
   check('missing-model',path.join(out,'broken/battle-worker.cjs'),fixtures.full,f=>f.phase==='error'&&f.direction?.ready&&f.strategy?.ready),
   check('without-opponents',path.resolve('dist/desktop/battle-worker.cjs'),fixtures.single,f=>f.phase==='waiting'&&f.direction?.ready)
  ]);
  console.log('DIRECTION_WORKER_INDEPENDENCE_PASS',JSON.stringify(results));app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
