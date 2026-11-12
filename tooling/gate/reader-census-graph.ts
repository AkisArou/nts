// Read-only investigation of a selected source tree. Instrumentation belongs
// only to this private copy; it cannot alter the selector used for a verdict.
import {readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {newTestScratch} from './test-scratch.ts';
import {removable} from './run-temporary.ts';
import type {FullGateCensus} from './full-gate-census.ts';
import type {Capture,Site,SiteKind,LostEdge} from './reader-census-analysis.ts';

type LegacyReference={literal:string;targets:string[]};
type Selector={stepInputs:()=>Map<string,Set<string>>;covering:(map:Map<string,Set<string>>,path:string)=>Set<string>;
  legacyReferences:Map<string,Record<SiteKind,LegacyReference[]>>;collectInvestigationCensus:()=>FullGateCensus};
const replace=(source:string,from:string,to:string)=>{assert.equal(source.split(from).length,2,'reader census unique instrumentation anchor: '+from.slice(0,80));return source.replace(from,to);};

export async function collectReaderCensus(sourceRoot:string,output:string){
  const root=resolve(sourceRoot),scratch=newTestScratch('728-reader-census');
  try{
    copyModuleClosure(['tooling/gate/owed.mjs'],scratch,{sourceRoot:root});
    symlinkSync(join(root,'node_modules'),join(scratch,'node_modules'));
    let source=readFileSync(join(scratch,'tooling/gate/owed.mjs'),'utf8');
    source='export const legacyReferences=new Map();\n'+source;
    source+=`\nexport function collectInvestigationCensus(){return collectFullGateCensus(trackedFiles(),path=>{const rules=owed([{path,added:false}]);return {full:rules.some(rule=>rule.full),reasons:rules.filter(rule=>rule.full).map(rule=>rule.name),policyReasons:rules.filter(rule=>rule.full&&!rule.fallback).map(rule=>rule.name)};},inputDirectoryDeclarations());}\n`;
    source=replace(source,'const body = readFileSync(abs, "utf8");',`const body = readFileSync(abs, "utf8");
        if (NO_MODULE_TEXT && /\\.[cm]?[jt]sx?$/.test(input)) {
          references={named:[],other:modules.closure([input])};
          inferred.set(input,references);queue.push(...references.other);continue;
        }`);
    source=replace(source,'references={named:named(body),other:[...imports(input,body),...beside]};\n        inferred.set(input,references);',`references={named:named(body),other:[...imports(input,body),...beside]};
        inferred.set(input,references);
        legacyReferences.set(input, {
          named:[...code(body).matchAll(PATH)].map(match=>({literal:match[1],targets:expand(match[1].replace(/\\/$/,""))})).concat([...code(body).matchAll(/["'](benchmarks)["']/g)].map(match=>({literal:match[1],targets:[match[1]]}))).filter(row=>row.targets.some(target=>references.named.includes(target))),
          imports:[...body.matchAll(/(?:from\\s+|import\\s*\\(\\s*|require\\(\\s*)["'](\\.{1,2}\\/[^"']+)["']/g)].map(match=>({literal:match[1],targets:[rel(resolve(TREE,dirname(input),match[1]))]})),
          beside:[...code(body).matchAll(/["']([A-Za-z0-9_.-]+\\.(?:tsv|json|known|txt|csv|ts|mjs|js|sh|py))["']/g)].map(match=>({literal:match[1],targets:[dirname(input)+"/"+match[1]]})).filter(row=>row.targets.some(target=>references.other.includes(target)))
        });`);
    const engines:{name:string;owner:Selector;map:Map<string,Set<string>>;full:FullGateCensus}[]=[];
    for(const [name,disabled]of [['before',false],['after',true]]as const){
      const file=join(scratch,'tooling/gate/owed-'+name+'.mjs');
      writeFileSync(file,'const NO_MODULE_TEXT='+disabled+';\n'+source);
      const owner=await import(pathToFileURL(file).href) as Selector;
      assert.ok(typeof owner.stepInputs==='function'&&typeof owner.covering==='function'&&owner.legacyReferences instanceof Map,'reader census selector protocol');
      const map=owner.stepInputs(),full=owner.collectInvestigationCensus();
      engines.push({name,owner,map,full});
    }
    const before=engines[0]!,after=engines[1]!;
    const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',maxBuffer:64<<20}).split('\0').filter(Boolean);
    const sites:Site[]=[],targets=new Map<string,Site[]>();
    for(const [reader,groups]of before.owner.legacyReferences){
      for(const kind of ['named','imports','beside']as const)for(const row of groups[kind]){
        const site:Site={reader,kind,literal:row.literal,targets:row.targets,steps:[...before.owner.covering(before.map,reader)].sort(),retainedSteps:[...after.owner.covering(after.map,reader)].sort(),lost:0};
        sites.push(site);for(const target of row.targets){const list=targets.get(target)??[];list.push(site);targets.set(target,list);}
      }
    }
    const lost:LostEdge[]=[],byStep:Record<string,number>={},missing:LostEdge[]=[];
    for(const path of files){
      const next=after.owner.covering(after.map,path);
      for(const step of before.owner.covering(before.map,path))if(!next.has(step)){
        const provenance=new Set<Site>();
        for(let prefix=path;;){for(const site of targets.get(prefix)??[])if(site.steps.includes(step))provenance.add(site);const slash=prefix.lastIndexOf('/');if(slash<0)break;prefix=prefix.slice(0,slash);}
        const sources=[...provenance].map(site=>{site.lost++;return sites.indexOf(site);});
        const edge={path,step,sources};lost.push(edge);byStep[step]=(byStep[step]??0)+1;if(!sources.length)missing.push(edge);
      }
    }
    const capture:Capture={sites,lost,missing};
    const metadata={source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),tracked:files.length,lostEdges:lost.length,lostPaths:new Set(lost.map(row=>row.path)).size,sites:sites.length,withoutProvenance:missing.length,byStep};
    writeFileSync(join(output,'provenance.json'),JSON.stringify(capture,null,2)+'\n');
    writeFileSync(join(output,'before-full.json'),JSON.stringify(before.full,null,2)+'\n');
    writeFileSync(join(output,'after-full.json'),JSON.stringify(after.full,null,2)+'\n');
    writeFileSync(join(output,'summary.json'),JSON.stringify(metadata,null,2)+'\n');
    return {capture,metadata,before:before.full,after:after.full};
  }finally{removable(scratch);rmSync(scratch,{recursive:true,force:true});}
}
