import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base=pathToFileURL(process.argv[2]+'/'),value=JSON.parse(readFileSync(new URL('./classified.json',base),'utf8'));
const source=JSON.parse(readFileSync(new URL('./summary.json',base),'utf8')).source;
const paths=[...new Set<string>(value.edges.map((edge:any)=>edge.path))].sort(),steps=[...new Set<string>(value.edges.map((edge:any)=>edge.step))].sort();
const pathIds=new Map(paths.map((path,index)=>[path,index])),stepIds=new Map(steps.map((step,index)=>[step,index]));
const sets:number[][]=[],setIds=new Map<string,number>(),roles=['retire','preserve-or-resolve','freshness'];
const edges=value.edges.map((edge:any)=>{
  const key=edge.frontiers.join(','),id=setIds.get(key)??sets.length;
  if(!setIds.has(key)){setIds.set(key,id);sets.push(edge.frontiers);}
  return [pathIds.get(edge.path),stepIds.get(edge.step),id,roles.indexOf(edge.disposition)];
});
const inventory={version:1,source,node:process.version,paths,steps,sites:value.sites,frontierSets:sets,dispositions:roles,edgeColumns:['path','step','frontierSet','disposition'],edges};
const bytes=JSON.stringify(inventory)+'\n',digest=createHash('sha256').update(bytes).digest('hex');
assert.equal(digest,'0c409f453dee0c913ef9dcebadc2968a7361f295469f47f10c49dd37d64a5475','the regenerated index must match the recorded bytes');
writeFileSync(new URL('./edges.json',base),bytes);
console.log(JSON.stringify({sha256:digest,bytes:Buffer.byteLength(bytes),edges:edges.length}));
