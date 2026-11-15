// Linker controls pre-acquire exactly the production corpus registry privately.
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gitArguments} from '../gate/git-arguments/main.ts';
import {corpus} from '../inputs/corpus.ts';
import {CORPORA} from '../inputs/corpora.ts';
import {TYPESCRIPT_NATIVE} from './typescript.ts';
import {outsideSource} from '../gate/source-containment.ts';
export const CORPUS_STORE_IGNORES=CORPORA.map(definition=>'/third_party/'+definition.slot+'.d/');
const SOURCE=fileURLToPath(new URL('../../',import.meta.url));
const local=(tree:string,url:URL)=>join(tree,relative(SOURCE,fileURLToPath(url)));

export function fixturePins(tree:string,pin:string):void{
  const destination=outsideSource(SOURCE,tree,'private corpus metadata');
  for(const definition of CORPORA)writeFileSync(local(destination,definition.pinSource),pin+'\n');
  const file=local(destination,TYPESCRIPT_NATIVE),native=JSON.parse(readFileSync(file,'utf8'));
  writeFileSync(file,JSON.stringify({...native,typescript_commit:pin})+'\n');
}

export function corporaFixture(directory:string,shared:string,trees:readonly string[],env:NodeJS.ProcessEnv):{upstream:string;pin:string;selected:Record<string,string>;awfy:string}{
  outsideSource(SOURCE,directory,'private corpus upstream');outsideSource(SOURCE,shared,'private corpus store');
  mkdirSync(directory);
  const upstream=join(directory,'upstream');mkdirSync(upstream);
  const git=(...args:string[])=>execFileSync('git',gitArguments(args),{cwd:upstream,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');
  for(const path of ['benchmarks/C++/fixture.txt','benchmarks/Java/fixture.txt','docs/README.md','tsc/testdata/tests/cases/control.ts','test/language/control.js','harness/assert.js','INTERPRETING.md']){
    const target=join(upstream,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,path.endsWith('/control.ts')||path.endsWith('/control.js')?"process.stdout.write('first\\n');\n":'private corpus\n');
  }
  git('add','.');git('-c','user.name=AWFY fixture','-c','user.email=awfy@fixture.invalid','commit','-qm','Private AWFY corpus');
  const pin=git('rev-parse','--verify','HEAD^{commit}');
  for(const tree of trees)fixturePins(tree,pin);
  // Commands and upstreams stay unchanged. Each staged definition verifies
  // its private data against a pre-acquired checkout and never fetches.
  const selected:Record<string,string>={};
  for(const definition of CORPORA){
    selected[definition.slot]=corpus({...definition,pinSource:pathToFileURL(local(trees[0]!,definition.pinSource)),upstream}).acquire(shared,env);
  }
  const awfy=selected['are-we-fast-yet'];if(!awfy)throw Error('the production corpus registry has no AWFY reference');
  return {upstream,pin,selected,awfy};
}
