// Unrelated linker controls keep AWFY's real verification in a private store.
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gitArguments} from '../gate/git-arguments/main.ts';
import {corpus} from '../inputs/corpus.ts';
import {AWFY} from './awfy.ts';

export function awfyFixture(directory:string,shared:string,trees:readonly string[],env:NodeJS.ProcessEnv):string{
  mkdirSync(directory);
  const upstream=join(directory,'upstream');mkdirSync(upstream);
  const git=(...args:string[])=>execFileSync('git',gitArguments(args),{cwd:upstream,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');
  for(const path of ['benchmarks/C++/fixture.txt','benchmarks/Java/fixture.txt','docs/README.md']){
    const target=join(upstream,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,'private AWFY corpus\n');
  }
  git('add','.');git('-c','user.name=AWFY fixture','-c','user.email=awfy@fixture.invalid','commit','-qm','Private AWFY corpus');
  const pin=git('rev-parse','--verify','HEAD^{commit}'),pinFile=join(directory,'source.pin');writeFileSync(pinFile,pin+'\n');
  const selected=corpus({...AWFY,pinSource:pathToFileURL(pinFile),upstream}).acquire(shared,env);
  const pinPath=relative(fileURLToPath(new URL('../../',import.meta.url)),fileURLToPath(AWFY.pinSource));
  // The production command remains untouched. Its pre-acquired pin only verifies.
  for(const tree of trees)writeFileSync(join(tree,pinPath),pin+'\n');
  return selected;
}
