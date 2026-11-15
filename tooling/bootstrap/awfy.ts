// One immutable revision for acquisition and every AWFY reference reader.
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fileInput} from '../gate/reader-inputs/main.ts';
import {gitArguments} from '../gate/git-arguments/main.ts';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {ToolingInstrumentError} from '../differential/command-entry/instrument.ts';

export const AWFY_PIN=fileInput(new URL('./awfy.pin',import.meta.url));
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const UPSTREAM='https://github.com/smarr/are-we-fast-yet';
const SPARSE=['benchmarks/C++','benchmarks/Java','docs'];
const failure=(message:string)=>new ToolingInstrumentError('tooling-setup',message);
export function corpusPin():string{
  const pin=readFileSync(AWFY_PIN,'utf8').trim();
  if(!/^[a-f0-9]{40}$/.test(pin))throw failure('invalid Are We Fast Yet corpus pin: '+fileURLToPath(AWFY_PIN));
  return pin;
}
function git(cwd:string,args:string[],env:NodeJS.ProcessEnv):string{
  try{return execFileSync('git',gitArguments(args),{cwd,env,encoding:'utf8',maxBuffer:16*2**20,stdio:['ignore','pipe','pipe']}).trim();}
  catch(error){throw failure('Are We Fast Yet corpus Git operation at '+cwd+': '+String(error));}
}
export function verifyCheckout(destination:string,pin:string,env:NodeJS.ProcessEnv):void{
  const remedy='run node tooling/bootstrap/awfy.ts --acquire <fresh checkout>; existing checkouts are never moved';
  if(!existsSync(destination))throw failure(`Are We Fast Yet corpus is missing at ${destination}; ${remedy}`);
  const actual=git(destination,['rev-parse','--verify','HEAD^{commit}'],env);
  if(actual!==pin)throw failure(`Are We Fast Yet corpus at ${destination} is ${actual}, requires ${pin}; ${remedy}`);
  const top=git(destination,['rev-parse','--show-toplevel'],env);
  if(realpathSync(top)!==realpathSync(destination))throw failure('Are We Fast Yet corpus is not its own checkout: '+destination);
  if(git(destination,['status','--porcelain','--untracked-files=all'],env))throw failure('Are We Fast Yet corpus has local changes at '+destination+'; preserve or discard them explicitly before reusing it');
  for(const path of SPARSE)if(!existsSync(join(destination,path)))throw failure('Are We Fast Yet corpus is missing '+path+' at '+destination+'; reapply its sparse checkout');
}
export function prepare(destination:string,options:{pin:string;env:NodeJS.ProcessEnv;source?:string}):void{
  if(existsSync(destination)){verifyCheckout(destination,options.pin,options.env);return;}
  mkdirSync(dirname(destination),{recursive:true});
  const stage=mkdtempSync(join(dirname(destination),'.awfy-'));
  try{
    git(stage,['init','--quiet'],options.env);
    git(stage,['remote','add','origin',options.source??UPSTREAM],options.env);
    git(stage,['sparse-checkout','set',...SPARSE],options.env);
    git(stage,['fetch','--depth','1','--filter=blob:none','origin',options.pin],options.env);
    git(stage,['checkout','--detach','FETCH_HEAD'],options.env);
    verifyCheckout(stage,options.pin,options.env);
    if(existsSync(destination))throw failure('Are We Fast Yet acquisition destination appeared: '+destination);
    renameSync(stage,destination);
  }finally{rmSync(stage,{recursive:true,force:true});}
}
runAsCommand(import.meta.url,()=>{
  const [mode='--acquire',argument,...extra]=process.argv.slice(2),env=process.env,pin=corpusPin();
  const destination=argument?resolve(argument):join(ROOT,'third_party/are-we-fast-yet');
  if(extra.length){
    if(extra.length!==2||extra[0]!=='--expected-pin'||extra[1]!==pin)throw failure('Are We Fast Yet compiled pin differs from '+fileURLToPath(AWFY_PIN));
  }
  if(mode==='--verify')verifyCheckout(destination,pin,env);
  else if(mode==='--verify-java'){
    const root=resolve(destination,'../..');
    if(resolve(root,'benchmarks/Java')!==destination)throw failure('Are We Fast Yet Java input must name benchmarks/Java: '+destination);
    verifyCheckout(root,pin,env);
  }else if(mode==='--acquire')prepare(destination,{pin,env});
  else throw failure('usage: awfy.ts --acquire|--verify <corpus checkout> | --verify-java <benchmarks/Java>');
});
