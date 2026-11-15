// A source owner changes a process value and its canonical packet together.
// This supplies no authority to a launcher's unregistered values.
import {ENVIRONMENT_CONTEXT} from '../differential/oracle-seal/main.ts';
import type {Context} from './environment-types.ts';
function valueContext(env:NodeJS.ProcessEnv):Context|undefined{
  const context:Context|undefined=env[ENVIRONMENT_CONTEXT]?JSON.parse(env[ENVIRONMENT_CONTEXT]):undefined;
  if(context&&(context.report?.version!==1||!context.owned))throw Error('invalid owned environment value handoff');
  return context;
}
/** Binding a later grant requires an already valid canonical packet. */
export function assertOwnedValueHandoff(env:NodeJS.ProcessEnv):void{valueContext(env);}
export function assignOwnedValues(env:NodeJS.ProcessEnv,values:NodeJS.ProcessEnv):void{
  const context=valueContext(env);
  for(const [name,value]of Object.entries(values)){
    if(value===undefined)delete env[name];else env[name]=value;
  }
  if(!context)return;
  const owned={...context.owned},host={...context.report.host},ambient={...context.report.ambient};
  for(const [name,value]of Object.entries(values)){
    if(value===undefined)delete owned[name];else owned[name]=value;
    if(name in host)host[name]=value??null;
    if(name in ambient)ambient[name]=value??null;
  }
  env[ENVIRONMENT_CONTEXT]=JSON.stringify({...context,owned,report:{...context.report,host,ambient}});
}
