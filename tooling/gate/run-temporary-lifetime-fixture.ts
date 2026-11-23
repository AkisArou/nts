import {chmodSync,mkdirSync,openSync,readFileSync,readSync,watch,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {captureRunTemporary,createRunOracleImage} from './run-temporary.ts';
import {closeRunTemporary,ownRunTemporary} from './run-temporary-lifetime.ts';
import {hostObservations} from './host-observations.ts';
import {durableRecord} from './durable-record.ts';
import {registerCommandCloser,runAsCommand} from '../differential/command-entry/main.ts';

runAsCommand(import.meta.url,async()=>{
  const [home,mode,ready]=process.argv.slice(2);
  if(!home||!mode||!ready)throw Error('lifetime fixture needs home, mode and readiness path');
  const env=JSON.parse(readFileSync(join(home,'environment.json'),'utf8')) as NodeJS.ProcessEnv,run=join(home,'.cache/runs',mode);
  const temporary=captureRunTemporary(run,undefined,home);
  const owner=ownRunTemporary(temporary,{...env,HOME:home},hostObservations(env));
  let green=false;
  registerCommandCloser('fixture temporary',{close:()=>{owner.close(green);}});
  for(const [name,content] of [['input.ts','throw 1;'],['stderr.txt','controlled stderr'],['reproducer.c','int main() {}'],['core.fixture','existing diagnostic']])writeFileSync(join(temporary.path,name!),content!);
  mkdirSync(join(temporary.path,'oracle-dependencies'));
  const image=createRunOracleImage(temporary,home,join(temporary.path,'oracle-dependencies/tree'));
  writeFileSync(join(image,'rebuildable'),'not retained');
  writeFileSync(join(temporary.path,'oracle-dependencies/stderr'),'capture stderr');
  mkdirSync(join(temporary.path,'unreadable'));writeFileSync(join(temporary.path,'unreadable/input.ts'),'inaccessible input');
  chmodSync(join(temporary.path,'unreadable'),0);
  if(mode==='force-copy'){
    closeRunTemporary(owner.file,owner.token,home,false,hostObservations(env),{checkpoint:(phase,directory)=>{
      if(phase!=='copying')return;
      writeFileSync(join(directory,'files/stderr.txt'),'partial');
      durableRecord(ready,{run,receipt:owner.file,token:owner.token});
      readSync(openSync(join(home,'pause'),'r'),Buffer.alloc(1),0,1,null);
      throw Error('copy interruption fixture unexpectedly resumed');
    }});
    throw Error('copy interruption fixture unexpectedly closed');
  }
  durableRecord(ready,{run,receipt:owner.file,token:owner.token});
  if(mode==='green'){green=true;return;}
  if(mode==='red')throw Error('controlled failure');
  await new Promise<void>(()=>{watch(home,()=>{});});
});
