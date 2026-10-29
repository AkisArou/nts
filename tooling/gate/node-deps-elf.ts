// Inspect the linked artifact; source flags alone cannot prove its dependencies.
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function needed(text:string):string[]{
 return text.split('\n').filter(line=>line.includes('(NEEDED)')).map(line=>{
  const name=/Shared library: \[([^\]\r\n]+)\]\s*$/.exec(line)?.[1];
  if(!name)throw Error('unrecognized ELF NEEDED entry: '+line);
  return name;
 });
}
export function forbidden(name:string):boolean {
 return /^lib(?:crypto|ssl|brotli(?:common|enc|dec)?|z|zstd|uv)(?:\.|-)/.test(name.split('/').at(-1)??'');
}
export function check(path:string):string[]{
 const text=execFileSync('readelf',['-dW',path],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const libraries=needed(text),bad=libraries.filter(forbidden);
 if(bad.length)throw Error(path+' links system Node dependencies: '+bad.join(', '));
 return libraries;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv.length<3)throw Error('usage: node-deps-elf.ts <linked ELF>...');
 for(const path of process.argv.slice(2))console.log(JSON.stringify({artifact:path,needed:check(path),system_node_dependencies:[]}));
}
