// One native plan for direct compiler clients as well as the shell adapters.
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';

const prepared = new Map();
export function bundledDependencies(compiler, libraries=['uv'], driver=['clang']) {
  const key=JSON.stringify([resolve(compiler),libraries,driver]);
  if(prepared.has(key))return prepared.get(key);
  if(process.platform!=='linux'||process.arch!=='x64')throw Error('bundled Node dependencies currently support Linux x86-64 only');
  const parent=process.env.TMPDIR??join(homedir(),'.cache/nts-tests');
  mkdirSync(parent,{recursive:true});
  const dir=mkdtempSync(join(parent,'node-deps-request-'));
  try {
    const file=join(dir,'request.json');
    const request={target:'x86_64-unknown-linux-gnu',compiler:driver,archiver:['llvm-ar'],flags:[],libraries,
      cache:join(process.env.XDG_CACHE_HOME??join(homedir(),'.cache'),'nts/node-deps'),jobs:4};
    writeFileSync(file,JSON.stringify(request,null,2)+'\n');
    const result=spawnSync(resolve(compiler),['node-deps',file],{encoding:'utf8',maxBuffer:16<<20});
    if(result.error||result.status!==0)throw Error(result.error?.message??('bundled native dependencies failed: '+result.stderr));
    const artifacts=JSON.parse(result.stdout);
    for(const field of ['include_flags','link_flags']) {
      if(!Array.isArray(artifacts[field])||!artifacts[field].every(word=>typeof word==='string'&&!word.includes('\0')))throw Error('invalid bundled dependency argv');
    }
    prepared.set(key,artifacts);
    return artifacts;
  } finally { rmSync(dir,{recursive:true,force:true}); }
}
