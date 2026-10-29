// The shell clients consume argv records from the same native Rust executor.
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {bundledDependencies} from './node-deps.mjs';

const [compiler,output]=process.argv.slice(2);
if(!compiler||!output)throw Error('usage: node-deps.ts <nts> <output.json>');
mkdirSync(dirname(output),{recursive:true});
const artifacts=bundledDependencies(compiler,['uv','openssl','zlib','brotli','zstd']);
for(const key of ['include_flags','link_flags']){
 if(!Array.isArray(artifacts[key])||!artifacts[key].every((s:unknown)=>typeof s==='string'&&!s.includes('\0')))throw Error('invalid dependency argv');
 writeFileSync(output+'.'+key,artifacts[key].join('\0')+'\0');
}
writeFileSync(output,JSON.stringify(artifacts,null,2)+'\n');
