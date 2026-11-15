// Read only the CPU controls of one acquired experiment cgroup. This is
// observation, never admission or a gate verdict policy.
import {readFileSync,statSync} from 'node:fs';
import {ToolingInstrumentError} from '../step-result.ts';

type Identity={dev:string;ino:string};
export type CpuControlEffects={identity():Identity;read(file:'cpu.max'|'cpu.stat'):string};
export function cpuControls(group:string,supplied?:CpuControlEffects){
  const fail=(why:string,cause?:unknown):never=>{throw new ToolingInstrumentError('tooling-setup','experiment CPU controls '+group+': '+why,{cause});};
  if(!group.startsWith('/')||group.split('/').includes('..')||/[\0\n]/.test(group))fail('invalid cgroup path');
  const root='/sys/fs/cgroup'+group;
  const effects=supplied===undefined?{
    identity:()=>{const s=statSync(root,{bigint:true});return {dev:String(s.dev),ino:String(s.ino)};},
    read:(name:'cpu.max'|'cpu.stat')=>readFileSync(root+'/'+name,'utf8'),
  }:supplied;
  if(typeof effects.identity!=='function'||typeof effects.read!=='function')fail('incomplete observation capability');
  let identity:Identity;
  try{identity={...effects.identity()};if(!/^\d+$/.test(identity.dev)||!/^\d+$/.test(identity.ino))fail('invalid acquired identity');}
  catch(error){return fail('cannot acquire cgroup identity: '+String(error),error);}
  const same=(value:Identity)=>value.dev===identity.dev&&value.ino===identity.ino;
  return {read(){
    try{
      if(!same(effects.identity()))fail('cgroup identity changed');
      const maximum=effects.read('cpu.max').trim().split(/\s+/),text=effects.read('cpu.stat');
      if(maximum.length!==2||!/^\d+$/.test(maximum[1]!)||Number(maximum[1])<=0
        ||maximum[0]!=='max'&&!/^\d+$/.test(maximum[0]!))fail('malformed cpu.max');
      const quotaUsec=maximum[0]==='max'?null:Number(maximum[0]),periodUsec=Number(maximum[1]);
      if(!Number.isSafeInteger(periodUsec)||quotaUsec!==null&&(!Number.isSafeInteger(quotaUsec)||quotaUsec<=0))fail('invalid CPU quota');
      const counters:Record<string,number>={};
      for(const line of text.trim().split('\n')){
        const row=/^(\S+)\s+(\d+)$/.exec(line),value=row?Number(row[2]):NaN;
        if(!row)return fail('malformed cpu.stat');
        if(!Number.isSafeInteger(value)||Object.hasOwn(counters,row[1]!))fail('malformed cpu.stat');
        counters[row[1]!]=value;
      }
      for(const key of ['usage_usec','user_usec','system_usec','nr_periods','nr_throttled','throttled_usec'])
        if(counters[key]===undefined)fail('missing '+key);
      if(!same(effects.identity()))fail('cgroup identity changed during observation');
      return {identity:{...identity},quotaUsec,periodUsec,counters};
    }catch(error){if(error instanceof ToolingInstrumentError)throw error;return fail(String(error),error);}
  }};
}
