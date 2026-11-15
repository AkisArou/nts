// One data declaration configures the shared pin-addressed corpus owner.
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fileInput} from '../gate/reader-inputs/main.ts';
import {corpus,type Corpus} from '../inputs/corpus.ts';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {ToolingInstrumentError} from '../differential/command-entry/instrument.ts';
export const AWFY:Corpus={pinSource:fileInput(new URL('./awfy.pin',import.meta.url)),
  upstream:'https://github.com/smarr/are-we-fast-yet',sparse:['benchmarks/C++','benchmarks/Java','docs'],slot:'are-we-fast-yet'};
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
runAsCommand(import.meta.url,()=>{
  const args=process.argv.slice(2),mode=args.shift()??'--acquire',env=process.env,owner=corpus(AWFY);
  const expected=args.indexOf('--expected-pin');
  if(expected>=0){
    if(expected!==args.length-2||args[expected+1]!==owner.pin)throw new ToolingInstrumentError('tooling-setup','Are We Fast Yet compiled pin differs from '+AWFY.pinSource.href);
    args.splice(expected,2);
  }
  const destination=resolve(args[0]??ROOT);
  if(mode==='--link'){
    if(args.length!==2)throw Error('usage: awfy.ts --link <shared checkout> <tree>');
    owner.link(destination,resolve(args[1]!),env);return;
  }
  if(args.length>1)throw Error('unexpected Are We Fast Yet arguments');
  if(mode==='--verify')owner.verify(destination,env);
  else if(mode==='--verify-java'){
    const root=resolve(destination,'../..');
    if(resolve(root,'benchmarks/Java')!==destination)throw Error('Are We Fast Yet Java input must name benchmarks/Java: '+destination);
    owner.verify(root,env);
  }else if(mode==='--resolve')process.stdout.write(JSON.stringify({version:1,pin:owner.pin,path:owner.resolve(destination,env)})+'\n');
  else if(mode==='--java-source'){
    const path=owner.resolve(destination,env);if(path)process.stdout.write(join(path,'benchmarks/Java'));
  }
  else if(mode==='--acquire')owner.acquire(owner.sharedRoot(destination,env),env);
  else throw Error('usage: awfy.ts --acquire <shared checkout> | --link <shared checkout> <tree> | --resolve <tree> | --verify <corpus checkout> | --verify-java <benchmarks/Java>');
});
