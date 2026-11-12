// Census evidence is separate from selector policy: review rows classify
// observed losses, and never grant a path reach or placement authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export type SiteKind='named'|'imports'|'beside';
export type Role='reader'|'data'|'project-context'|'existing-import'|'generator-provenance';
export type Disposition='retire'|'preserve-or-resolve'|'freshness';
export type Site={reader:string;kind:SiteKind;literal:string;targets:string[];steps:string[];retainedSteps:string[];lost:number};
export type LostEdge={path:string;step:string;sources:number[]};
export type Capture={sites:Site[];lost:LostEdge[];missing:LostEdge[]};
export type FrontierSite=Site&{id:number;lostSteps:string[]};
export type FrontierEdge={path:string;step:string;frontiers:number[]};
export type Reader={reader:string;sites:number;steps:string[];ids:number[]};
export type Frontiers={sites:FrontierSite[];readers:Reader[];edges:FrontierEdge[]};
export type Classification={role:Role;reason:string};
export type ClassifiedSite=FrontierSite&Classification;
export type ClassifiedEdge=FrontierEdge&{disposition:Disposition};
export type Classified={sites:ClassifiedSite[];readers:(Reader&{roles:Role[]})[];edges:ClassifiedEdge[]};
const siteKey=(site:Pick<Site,'reader'|'kind'|'literal'>)=>[site.reader,site.kind,site.literal].join('\0');
const roles=new Set<Role>(['reader','data','project-context','existing-import','generator-provenance']);
const preserve=(role:Role)=>role==='reader'||role==='existing-import'||role==='project-context';

export function readClassifications(tsv:string):Map<string,Classification>{
  const [header,...lines]=tsv.trimEnd().split('\n');
  assert.equal(header,'id\treader\tkind\tliteral\trole\tsteps\treason','reader census classification header');
  const result=new Map<string,Classification>();
  for(const line of lines){
    const fields=line.split('\t');assert.equal(fields.length,7,'reader census classification fields');
    const [,reader,kind,literal,rawRole,,reason]=fields;
    assert.ok(reader&&literal&&reason&&(kind==='named'||kind==='imports'||kind==='beside'));
    assert.ok(roles.has(rawRole as Role),'reader census unknown classification role: '+rawRole);
    const key=siteKey({reader,kind,literal}),row={role:rawRole as Role,reason};
    if(result.has(key))assert.deepEqual(result.get(key),row,'conflicting reader census classification: '+reader+' '+literal);
    result.set(key,row);
  }
  return result;
}

export function firstLosses(capture:Capture):Frontiers{
  const {sites,lost}=capture,targets=new Map<string,number[]>();
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
        const site=sites[id]!;if(!site.steps.includes(step))continue;
        if(site.retainedSteps.includes(step))result.add(id);else queue.push(site.reader);
      }
    }
    const ids=[...result].sort((a,b)=>a-b);cached.set(key,ids);return ids;
  }
  const frontiers=new Map<number,Set<string>>(),edges:FrontierEdge[]=[];
  for(const edge of lost){
    const ids=new Set<number>();
    for(const id of edge.sources){const site=sites[id];assert.ok(site,'reader census unknown provenance site');if(site.retainedSteps.includes(edge.step))ids.add(id);else for(const parent of roots(site.reader,edge.step))ids.add(parent);}
    assert.ok(ids.size,'reader census has no first-loss provenance: '+edge.path+' '+edge.step);
    const ordered=[...ids].sort((a,b)=>a-b);
    edges.push({path:edge.path,step:edge.step,frontiers:ordered});
    // The retained index records first-observed site order. Edge references
    // are sorted separately; sorting these rows would change its bytes.
    for(const id of ids){const steps=frontiers.get(id)??new Set<string>();steps.add(edge.step);frontiers.set(id,steps);}
  }
  const rows=[...frontiers].map(([id,steps])=>({id,...sites[id]!,lostSteps:[...steps].sort()}));
  const readerRows=new Map<string,{reader:string;sites:number;steps:Set<string>;ids:number[]}>();
  for(const row of rows){const next=readerRows.get(row.reader)??{reader:row.reader,sites:0,steps:new Set<string>(),ids:[]};next.sites++;for(const step of row.lostSteps)next.steps.add(step);next.ids.push(row.id);readerRows.set(row.reader,next);}
  return {sites:rows,readers:[...readerRows.values()].map(row=>({...row,steps:[...row.steps].sort()})),edges};
}

export function classifyLosses(value:Frontiers,review:Map<string,Classification>):Classified{
  const sites=value.sites.map(site=>{const row=review.get(siteKey(site));assert.ok(row,'reader census unclassified first loss: '+site.reader+' '+site.literal);return {...site,...row};});
  const byId=new Map(sites.map(site=>[site.id,site]));
  const edges=value.edges.map(edge=>{
    const reached=[...new Set(edge.frontiers.map(id=>byId.get(id)!.role))];
    const disposition:Disposition=reached.some(preserve)?'preserve-or-resolve':reached.includes('generator-provenance')?'freshness':'retire';
    return {...edge,disposition};
  });
  return {sites,readers:value.readers.map(reader=>({...reader,roles:[...new Set(sites.filter(site=>site.reader===reader.reader).map(site=>site.role))]})),edges};
}

export function sliceBudgets(value:Classified){
  const group=(reader:string)=>{
    if(reader.startsWith('tooling/census/')&&!reader.endsWith('/definitions.ts')||reader==='tooling/records/record-pending.ts')return 'test262-and-typescript';
    if(reader.startsWith('tooling/bench/')||reader.startsWith('tooling/differential/')||reader.includes('compile-counter'))return 'benches-and-oracles';
    if(reader.startsWith('tooling/conformance/')||reader.startsWith('tooling/config/')||reader.startsWith('runtime/')||reader.startsWith('tests/interop/')||reader.endsWith('/definitions.ts'))return 'runtime-and-config';
    return 'tooling';
  };
  const sites=new Map(value.sites.map(site=>[site.id,{...site,group:group(site.reader)}]));
  let remaining=value.edges.filter(edge=>edge.disposition==='preserve-or-resolve');
  const plan:{group:string;assignedEdges:number;remaining:number;sites:number;readers:string[];byStep:Record<string,number>}[]=[],groups=['tooling','test262-and-typescript','benches-and-oracles','runtime-and-config'];
  const eligible=(name:string,edge:ClassifiedEdge)=>edge.frontiers.some(id=>{const site=sites.get(id)!;return site.group===name&&preserve(site.role);});
  while(groups.length){
    groups.sort((a,b)=>remaining.filter(edge=>eligible(b,edge)).length-remaining.filter(edge=>eligible(a,edge)).length||a.localeCompare(b));
    const name=groups.shift()!,selected=remaining.filter(edge=>eligible(name,edge));
    const ids=new Set(selected.flatMap(edge=>edge.frontiers.filter(id=>{const site=sites.get(id)!;return site.group===name&&preserve(site.role);})));
    plan.push({group:name,assignedEdges:selected.length,remaining:remaining.length-selected.length,sites:ids.size,readers:[...new Set([...ids].map(id=>sites.get(id)!.reader))].sort(),byStep:Object.fromEntries([...new Set(selected.map(edge=>edge.step))].map(step=>[step,selected.filter(edge=>edge.step===step).length]))});
    remaining=remaining.filter(edge=>!eligible(name,edge));
  }
  assert.equal(remaining.length,0,'reader census has unassigned preservation edges');return plan;
}

export function encodeIndex(value:Classified,source:string,node:string){
  const paths=[...new Set(value.edges.map(edge=>edge.path))].sort(),steps=[...new Set(value.edges.map(edge=>edge.step))].sort();
  const pathIds=new Map(paths.map((path,index)=>[path,index])),stepIds=new Map(steps.map((step,index)=>[step,index]));
  const sets:number[][]=[],setIds=new Map<string,number>(),dispositions:Disposition[]=['retire','preserve-or-resolve','freshness'];
  const edges=value.edges.map(edge=>{const key=edge.frontiers.join(','),id=setIds.get(key)??sets.length;if(!setIds.has(key)){setIds.set(key,id);sets.push(edge.frontiers);}return [pathIds.get(edge.path),stepIds.get(edge.step),id,dispositions.indexOf(edge.disposition)];});
  const inventory={version:1,source,node,paths,steps,sites:value.sites,frontierSets:sets,dispositions,edgeColumns:['path','step','frontierSet','disposition'],edges};
  const bytes=JSON.stringify(inventory)+'\n';return {bytes,sha256:createHash('sha256').update(bytes).digest('hex'),edges:edges.length};
}
