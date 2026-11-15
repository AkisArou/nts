// The production linker and its fixtures consume this same finite registry.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {AWFY} from '../bootstrap/awfy.ts';
import {TYPESCRIPT} from '../bootstrap/typescript.ts';
import {TEST262} from '../bootstrap/test262.ts';
import {corpus} from './corpus.ts';
export const CORPORA=[AWFY,TYPESCRIPT,TEST262] as const;
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
runAsCommand(import.meta.url,()=>{
  const [mode='--prepare',...paths]=process.argv.slice(2),env=process.env;
  if(mode==='--link'){
    if(paths.length!==2)throw Error('usage: corpora.ts --link shared tree');
    for(const definition of CORPORA)corpus(definition).link(resolve(paths[0]!),resolve(paths[1]!),env);
  }else if(mode==='--prepare'||mode==='--acquire'){
    if(paths.length>1)throw Error('usage: corpora.ts --prepare|--acquire [tree]');
    const tree=resolve(paths[0]??ROOT);
    for(const definition of CORPORA){const owner=corpus(definition),shared=owner.sharedRoot(tree,env);
      process.stdout.write(JSON.stringify({slot:definition.slot,...(mode==='--prepare'?owner.prepare(shared,tree,env):{path:owner.acquire(shared,env)})})+'\n');}
  }else throw Error('usage: corpora.ts --link shared tree | --prepare|--acquire [tree]');
});
