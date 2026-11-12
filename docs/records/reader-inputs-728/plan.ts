import {pathToFileURL} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
const base=pathToFileURL(process.argv[2]+'/'),value=JSON.parse(readFileSync(new URL('./classified.json',base),'utf8'));
function group(reader:string):string{
  if(reader.startsWith('tooling/census/')&&!reader.endsWith('/definitions.ts')||reader==='tooling/records/record-pending.ts')return 'test262-and-typescript';
  if(reader.startsWith('tooling/bench/')||reader.startsWith('tooling/differential/')||reader.includes('compile-counter'))return 'benches-and-oracles';
  if(reader.startsWith('tooling/conformance/')||reader.startsWith('tooling/config/')||reader.startsWith('runtime/')||reader.startsWith('tests/interop/')||reader.endsWith('/definitions.ts'))return 'runtime-and-config';
  return 'tooling';
}
const sites=new Map<number,any>(value.sites.map((site:any)=>[site.id,{...site,group:group(site.reader)}]));
let remaining=value.edges.filter((edge:any)=>edge.disposition==='preserve-or-resolve');
const plan:any[]=[],groups=['tooling','test262-and-typescript','benches-and-oracles','runtime-and-config'];
while(groups.length){
  const eligible=(name:string,edge:any)=>edge.frontiers.some((id:number)=>{const site=sites.get(id);return site.group===name&&['reader','existing-import','project-context'].includes(site.role);});
  groups.sort((a,b)=>remaining.filter((edge:any)=>eligible(b,edge)).length-remaining.filter((edge:any)=>eligible(a,edge)).length||a.localeCompare(b));
  const name=groups.shift()!;
  const owns=(edge:any)=>edge.frontiers.some((id:number)=>{const site=sites.get(id);return site.group===name&&['reader','existing-import','project-context'].includes(site.role);});
  const selected=remaining.filter(owns),ids=new Set<number>(selected.flatMap((edge:any)=>edge.frontiers.filter((id:number)=>{const site=sites.get(id);return site.group===name&&['reader','existing-import','project-context'].includes(site.role);})));
  plan.push({group:name,assignedEdges:selected.length,remaining:remaining.length-selected.length,sites:ids.size,readers:[...new Set([...ids].map(id=>sites.get(id).reader))].sort(),byStep:Object.fromEntries([...new Set<string>(selected.map((edge:any)=>edge.step))].map(step=>[step,selected.filter((edge:any)=>edge.step===step).length]))});
  remaining=remaining.filter((edge:any)=>!owns(edge));
}
if(remaining.length)throw Error('unassigned edges: '+remaining.length);
writeFileSync(new URL('./slice-budgets.json',base),JSON.stringify(plan,null,2)+'\n');
console.log(JSON.stringify(plan.map(({readers,...row})=>({...row,readers:readers.length})),null,2));
