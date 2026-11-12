import {gitArguments} from "../gate/git-arguments/main.ts";
import {testEnvironment} from "../gate/test-environment.ts";
// Small real git/source identities for selector and landing-consumer controls.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {inputFiles} from '../bootstrap/node.ts';
import type {Records} from './node-inputs.ts';
export function fixtureInputs(root:string,release:string):Records{
  mkdirSync(root,{recursive:true});writeFileSync(join(root,'.tool-versions'),'nodejs '+release+'\n');
  const node=join(root,'third_party/node'),source=join(root,'third_party/node-source');
  for(const dir of [join(node,'lib'),join(source,'src'),join(root,'build/node-deps')])mkdirSync(dir,{recursive:true});
  writeFileSync(join(node,'lib/control.js'),'module.exports='+JSON.stringify(release)+';\n');
  mkdirSync(join(node,'lib/prefix'),{recursive:true});writeFileSync(join(node,'lib/prefix/inside.js'),'inside\n');writeFileSync(join(node,'lib/prefix.js'),'sibling\n');
  writeFileSync(join(node,'.gitignore'),'target/\n');symlinkSync('control.js',join(node,'lib/control-link.js'));
  const git=(...args:string[])=>execFileSync('git',gitArguments(['-C',node,...args]),{env:testEnvironment(),encoding:'utf8'}).trim();
  git('init','-q');git('add','.');git('-c','user.name=Node inputs control','-c','user.email=control@example.invalid','commit','-qm','upstream release');
  writeFileSync(join(node,'package.json'),'{ "type": "commonjs" }\n');
  for(const dep of ['openssl','brotli','zlib','zstd','uv']){
    mkdirSync(join(source,'deps',dep),{recursive:true});writeFileSync(join(source,'deps',dep,'source.c'),release+' '+dep+'\n');
  }
  symlinkSync('source.c',join(source,'deps/uv/source-link.c'));
  const parts=release.split('.');writeFileSync(join(source,'src/node_version.h'),['MAJOR','MINOR','PATCH'].map((p,i)=>'#define NODE_'+p+'_VERSION '+parts[i]+'\n').join(''));
  const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
  const archive=hash('archive '+release),stamp=JSON.stringify({version:release,archive_sha256:archive,files:inputFiles(source)})+'\n';
  writeFileSync(join(source,'NTS-SOURCE.json'),stamp);
  writeFileSync(join(root,'build/node-deps/recipes.json'),JSON.stringify({node:release,source_sha256:archive,files:{'deps/uv/source.c':hash(readFileSync(join(source,'deps/uv/source.c')))}})+'\n');
  return {version:1,releases:{[release]:{commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),archive,sourceRecord:hash(stamp)}}};
}
