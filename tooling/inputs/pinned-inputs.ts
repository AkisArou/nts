// Explicit acquisition publishes hash-pinned source bytes. Every consumer is
// offline and verifies the actual payload again; a cache record is no proof
// that the bytes it contains still match the candidate's catalog.
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {cacheLocation,contentCacheEnvironment} from '../gate/cache-environment.ts';
import {durableRecord} from '../gate/durable-record.ts';
import {GateResource} from '../gate/gate-resource.ts';
import {ToolingInstrumentError,publishToolingFailure} from '../gate/step-result.ts';

export type PinnedInput=Readonly<{name:string;url:string;sha256:string;version:string}>;
type Catalog={version:1;inputs:Record<string,{url:string;sha256:string;version:string}>};
const failure=(message:string)=>new ToolingInstrumentError('tooling-setup','pinned input: '+message);
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
// This only bounds a wedged acquisition instrument, never a freshness verdict.
// Several minutes tolerate a slow network while keeping provisioning finite.
const ACQUISITION_MS=5*60_000;

export function pinnedInput(name:string,catalog:unknown=JSON.parse(readFileSync(new URL('./pinned-inputs.json',import.meta.url),'utf8'))):PinnedInput{
  const table=catalog as Partial<Catalog>|null,row=table?.inputs?.[name];
  if(table?.version!==1||!Object.hasOwn(table.inputs??{},name)||!row||
      typeof row.url!=='string'||typeof row.sha256!=='string'||!/^\w[\w.-]*$/.test(name)||
      !/^[a-f0-9]{64}$/.test(row.sha256)||typeof row.version!=='string'||!row.version.length)
    throw failure('missing or invalid catalog entry '+name);
  let url:URL;try{url=new URL(row.url);}catch{throw failure('invalid URL for '+name);}
  if(url.protocol!=='https:'||url.username||url.password)throw failure('expected an HTTPS source for '+name);
  return Object.freeze({name,url:row.url,sha256:row.sha256,version:row.version});
}

export function pinnedInputCache(env:NodeJS.ProcessEnv=process.env):string{
  return cacheLocation('NTS_PINNED_INPUTS_CACHE',env,()=>contentCacheEnvironment(env).NTS_PINNED_INPUTS_CACHE!);
}
export function pinnedInputFile(input:PinnedInput,cache=pinnedInputCache()):string{return join(cache,input.sha256+'.json');}
function checked(input:PinnedInput,bytes:Buffer):Buffer{
  const actual=digest(bytes);
  if(actual!==input.sha256)throw failure(`${input.name} SHA-256 mismatch: ${actual}; expected ${input.sha256}`);
  return bytes;
}

/** Offline means missing and damaged content refuse; neither path fetches. */
export function readPinnedInput(input:PinnedInput,options:{cache?:string;env?:NodeJS.ProcessEnv}={}):Buffer{
  const file=pinnedInputFile(input,options.cache??pinnedInputCache(options.env));
  let record:unknown;
  try{record=JSON.parse(readFileSync(file,'utf8'));}
  catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT')throw failure(`missing ${input.name} at ${file}; acquire it with node tooling/inputs/pinned-inputs.ts --acquire ${input.name}`);
    throw failure(`cannot read ${input.name} at ${file}: ${String(error)}`);
  }
  const row=record as {version?:unknown;sha256?:unknown;bytesBase64?:unknown}|null;
  if(row?.version!==1||row.sha256!==input.sha256||typeof row.bytesBase64!=='string')
    throw failure(`invalid content record for ${input.name} at ${file}; left untouched`);
  const bytes=Buffer.from(row.bytesBase64,'base64');
  if(bytes.toString('base64')!==row.bytesBase64)throw failure(`invalid base64 payload for ${input.name} at ${file}; left untouched`);
  return checked(input,bytes);
}

type Acquisition={cache?:string;env?:NodeJS.ProcessEnv;fetcher?:typeof fetch};
/** The only online route. Publication reuses the existing durable-record owner. */
export async function acquirePinnedInput(input:PinnedInput,options:Acquisition={}):Promise<string>{
  const cache=options.cache??pinnedInputCache(options.env),file=pinnedInputFile(input,cache);
  let lock:GateResource|null;
  while(!(lock=GateResource.tryAcquire(join(cache,'locks',input.sha256+'.lock'))))await pause(100);
  try{
    if(existsSync(file)){readPinnedInput(input,{cache});return file;}
    let bytes:Buffer;
    try{
      const response=await (options.fetcher??fetch)(input.url,{signal:AbortSignal.timeout(ACQUISITION_MS)});
      if(!response.ok)throw Error('HTTP '+response.status+' from '+input.url);
      bytes=checked(input,Buffer.from(await response.arrayBuffer()));
    }catch(error){throw error instanceof ToolingInstrumentError?error:failure(`cannot acquire ${input.name}: ${String(error)}`);}
    durableRecord(file,{version:1,sha256:input.sha256,url:input.url,inputVersion:input.version,bytesBase64:bytes.toString('base64')});
    return file;
  }finally{lock.close();}
}

runAsCommand(import.meta.url,async()=>{
  const [mode,name,...extra]=process.argv.slice(2);
  try{
    if(!name||extra.length||!['--acquire','--verify'].includes(mode??''))throw failure('usage: pinned-inputs.ts --acquire|--verify <catalog name>');
    const input=pinnedInput(name);
    if(mode==='--acquire')await acquirePinnedInput(input);
    const bytes=readPinnedInput(input);
    console.log(JSON.stringify({name:input.name,version:input.version,sha256:input.sha256,bytes:bytes.length}));
  }catch(error){const problem=error instanceof ToolingInstrumentError?error:failure(String(error));publishToolingFailure(problem);console.error(problem.message);return 2;}
  return 0;
});
