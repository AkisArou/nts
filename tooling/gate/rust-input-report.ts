// One lossless wire format. Repeated claim arrays, answers, component sets and
// scopes are content-addressed; syscall rows keep only their references.
import {createHash} from 'node:crypto';
import {readCompressedRecords} from './file-input-observer.ts';
import type {RuntimeClaimAnswer} from './rust-input-claims.ts';
import type {RuntimeSubjectAssessment} from './rust-input-validation.ts';

type Row=Record<string,unknown>;
type Resolve=(key:string)=>unknown;
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
function object(value:unknown):Row{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Rust input report: expected object');
  return value as Row;
}
export function rustInputReportPool(emit:(row:unknown)=>Promise<void>){
  const seen=new Map<string,string>();
  const intern=async(value:unknown)=>{
    const text=JSON.stringify(value);if(text===undefined)throw Error('Rust input report: undefined table value');
    const key=digest(text),previous=seen.get(key);
    if(previous!==undefined){if(previous!==text)throw Error('Rust input report: content hash collision');return key;}
    seen.set(key,text);await emit({kind:'validation-table',key,value});return key;
  };
  const answer=async(value:RuntimeClaimAnswer)=>({kind:value.kind,ref:await intern(value.kind==='claimed'
    ?{kind:'claimed',claims:await intern(value.claims)}:value)});
  return {async subject(value:RuntimeSubjectAssessment&{scope:unknown}){
    const {endpoint,components,scope,...rest}=value;
    const rows=[];for(const row of components)rows.push({observation:row.observation,answer:await answer(row.answer)});
    return {...rest,...(endpoint?{endpoint:await answer(endpoint)}:{}),components:{state:components.every(row=>row.answer.kind==='claimed')?'claimed':'uncovered',ref:await intern(rows)},
      scope:{ref:await intern(scope)}};
  }};
}
function reference(value:unknown,resolve:Resolve):unknown{
  const row=object(value);if(typeof row.ref!=='string')throw Error('Rust input report: missing reference');return resolve(row.ref);
}
function answer(value:unknown,resolve:Resolve):RuntimeClaimAnswer{
  const ref=object(value),row=object(reference(ref,resolve));
  if(ref.kind!==row.kind)throw Error('Rust input report: answer state differs from table');
  if(row.kind==='uncovered'&&typeof row.reason==='string')return {kind:'uncovered',reason:row.reason};
  if(row.kind==='claimed'&&typeof row.claims==='string'){
    const claims=resolve(row.claims);if(!Array.isArray(claims))throw Error('Rust input report: claim table is not an array');
    return {kind:'claimed',claims:structuredClone(claims) as Extract<RuntimeClaimAnswer,{kind:'claimed'}>['claims']};
  }
  throw Error('Rust input report: malformed answer');
}
/** Decode only when detail is consumed; aggregators can inspect reference
 * states without repeatedly expanding the same arrays. Both use this reader. */
export function decodeRustInputSubject(row:Row,resolve:Resolve):Row{
  if(row.kind!=='runtime-subject')return row;
  const components=reference(row.components,resolve);
  if(!Array.isArray(components))throw Error('Rust input report: components are not an array');
  return {...row,...(row.endpoint?{endpoint:answer(row.endpoint,resolve)}:{}),
    components:components.map(value=>{const part=object(value);return {observation:structuredClone(part.observation),answer:answer(part.answer,resolve)};}),
    scope:structuredClone(reference(row.scope,resolve))};
}
export async function readRustInputValidation(file:string,visit:(row:Row,resolve:Resolve)=>void|Promise<void>):Promise<void>{
  const table=new Map<string,unknown>();let started=false,complete=false;
  const lookup:Resolve=key=>{
    if(!table.has(key))throw Error('Rust input report: missing table reference '+key);
    return table.get(key);
  };
  const resolve:Resolve=key=>structuredClone(lookup(key));
  await readCompressedRecords(file,async value=>{
    const row=object(value);if(complete)throw Error('Rust input report: row after completion');
    if(!started){if(row.kind!=='validation-start'||row.version!==3)throw Error('Rust input report: unsupported report version');started=true;}
    if(row.kind==='validation-table'){
      if(typeof row.key!=='string'||digest(JSON.stringify(row.value))!==row.key||table.has(row.key))throw Error('Rust input report: invalid or duplicate table hash');
      table.set(row.key,structuredClone(row.value));return;
    }
    if(row.kind==='runtime-subject'){
      const components=reference(row.components,lookup);reference(row.scope,lookup);
      if(!Array.isArray(components))throw Error('Rust input report: malformed component set');
      const check=(value:unknown)=>{
        const ref=object(value),entry=object(reference(ref,lookup));
        if(ref.kind!==entry.kind)throw Error('Rust input report: answer state differs from table');
        if(entry.kind==='claimed'){
          if(typeof entry.claims!=='string'||!Array.isArray(lookup(entry.claims)))throw Error('Rust input report: missing claim array');
        }else if(entry.kind!=='uncovered'||typeof entry.reason!=='string')throw Error('Rust input report: malformed answer');
      };
      if(row.endpoint)check(row.endpoint);
      for(const value of components){const part=object(value);check(part.answer);}
      const state=components.every(value=>object(object(value).answer).kind==='claimed')?'claimed':'uncovered';
      if(object(row.components).state!==state)throw Error('Rust input report: component state differs from table');
    }
    if(row.kind==='validation-complete'){if(row.version!==3||row.complete!==true)throw Error('Rust input report: incomplete footer');complete=true;}
    await visit(row,resolve);
  });
  if(!started||!complete)throw Error('Rust input report: missing completion');
}
