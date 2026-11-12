import {pathToFileURL} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const base=pathToFileURL(process.argv[2]+'/'),capture=JSON.parse(readFileSync(new URL('./provenance.json',base),'utf8'));
const sites:any[]=capture.sites,lost:any[]=capture.lost,targets=new Map<string,number[]>();
for(const [index,site]of sites.entries())for(const target of site.targets){const ids=targets.get(target)??[];ids.push(index);targets.set(target,ids);}
const parents=new Map<string,number[]>();
function covering(path:string):number[]{
  const known=parents.get(path);if(known)return known;
  const ids:number[]=[];
  for(let prefix=path;;){ids.push(...targets.get(prefix)??[]);const slash=prefix.lastIndexOf('/');if(slash<0)break;prefix=prefix.slice(0,slash);}
  parents.set(path,ids);return ids;
}
const cached=new Map<string,number[]>();
function roots(reader:string,step:string):number[]{
  const key=reader+'\0'+step,known=cached.get(key);if(known)return known;
  const seen=new Set<string>(),queue=[reader],result=new Set<number>();
  while(queue.length){const current=queue.pop()!;if(seen.has(current))continue;seen.add(current);
    for(const id of covering(current)){
      const site=sites[id];if(!site.steps.includes(step))continue;
      if(site.retainedSteps.includes(step))result.add(id);else queue.push(site.reader);
    }
  }
  const ids=[...result].sort((a,b)=>a-b);cached.set(key,ids);return ids;
}
const frontiers=new Map<number,Set<string>>(),unresolved:any[]=[],byStep=new Map<string,Set<number>>();
for(const edge of lost){
  const ids=new Set<number>();
  for(const id of edge.sources){const site=sites[id];if(site.retainedSteps.includes(edge.step))ids.add(id);else for(const parent of roots(site.reader,edge.step))ids.add(parent);}
  if(!ids.size)unresolved.push(edge);
  edge.frontiers=[...ids].sort((a,b)=>a-b);
  for(const id of ids){const steps=frontiers.get(id)??new Set<string>();steps.add(edge.step);frontiers.set(id,steps);}
  const set=byStep.get(edge.step)??new Set<number>();for(const id of ids)set.add(id);byStep.set(edge.step,set);
}
assert.equal(unresolved.length,0,'every lost edge traces to a retained reader');
const rows=[...frontiers].map(([id,steps])=>({id,...sites[id],lostSteps:[...steps].sort()}));
const readerRows=new Map<string,{reader:string;sites:number;steps:Set<string>;ids:number[]}>();
for(const row of rows){const next=readerRows.get(row.reader)??{reader:row.reader,sites:0,steps:new Set<string>(),ids:[]};next.sites++;for(const step of row.lostSteps)next.steps.add(step);next.ids.push(row.id);readerRows.set(row.reader,next);}
const readers=[...readerRows.values()].map(row=>({...row,steps:[...row.steps].sort()}));
writeFileSync(new URL('./frontiers.json',base),JSON.stringify({sites:rows,readers,edges:lost.map(({path,step,frontiers})=>({path,step,frontiers}))},null,2)+'\n');
console.log(JSON.stringify({lostEdges:lost.length,sites:rows.length,readers:readers.length,byRoot:Object.fromEntries([...new Set(readers.map(row=>row.reader.split('/')[0]))].map(root=>[root,readers.filter(row=>row.reader.startsWith(root+'/')).length])),byStep:Object.fromEntries([...byStep].map(([step,ids])=>[step,ids.size]))}));
