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
   check('without-opponents',path.resolve('dist/desktop/battle-worker.cjs'),fixtures.single,f=>f.phase==='waiting'&&f.direction?.ready),
   check('startup-mainline',path.resolve('dist/desktop/battle-worker.cjs'),fixtures.startup,f=>f.direction?.ready&&f.direction.mode==='selected'&&f.tactics?.ready&&f.tactics.maxSwaps===2&&f.tactics.choices.some(c=>c.mainlineCores?.length===2))
  ]);
  results.push(await check('unencoded-summons',path.resolve('dist/desktop/battle-worker.cjs'),fixtures.unencoded,f=>f.phase==='ready'&&f.tactics?.ready&&f.gaps.some(g=>g.includes('召唤单位'))));
  results.push(await check('independent-tower',path.resolve('dist/desktop/battle-worker.cjs'),fixtures.tower,f=>f.phase==='ready'&&f.tactics?.ready&&f.tactics.choices.every(c=>c.auxiliary?.some(u=>u.id==='DA_TheTower_TrainingDummy'&&u.items.includes('DA_WarmogsArmor')))));
  results.push(await check('live-lux-form',path.resolve('dist/desktop/battle-worker.cjs'),fixtures.form,f=>f.phase==='ready'&&f.tactics?.ready&&f.tactics.choices.every(c=>c.onBoardCombatIds?.length===c.onBoard.length)));
  results.push(await check('search-landings',path.resolve('dist/desktop/battle-worker.cjs'),fixtures.landing,f=>f.landings?.ready&&f.landings.plans.length>0&&f.landings.plans.every(p=>p.bands.length===2&&p.bands.every(b=>b.combat.lower<=b.combat.upper&&b.completion.lower<=b.completion.upper))));
  results.push(await check('equipment-handoffs',path.resolve('dist/desktop/battle-worker.cjs'),fixtures.handoff,f=>f.handoffs?.ready&&f.handoffs.choices.length>0&&f.handoffs.choices.every(c=>c.moves.length>0&&c.lowerGain<=c.upperGain)));
  console.log('DIRECTION_WORKER_INDEPENDENCE_PASS',JSON.stringify(results));app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
