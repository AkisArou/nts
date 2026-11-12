// Read-only source investigation: only the private staged selector is instrumented.
import {readFileSync,writeFileSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {copyModuleClosure} from '../../../tooling/gate/module-closure-fixture.ts';
import {newTestScratch} from '../../../tooling/gate/test-scratch.ts';
import {removable} from '../../../tooling/gate/run-temporary.ts';
import assert from 'node:assert/strict';

const root=process.argv[2],output=pathToFileURL(process.argv[3]+'/');
if(!root||!process.argv[3])throw Error('usage: census.ts <source tree at recorded pin> <output directory> [--full]');
mkdirSync(output,{recursive:true});process.chdir(root);
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),'08852c508f035ff4e946eb91e36dd180ace498ec','the census reproduces one recorded source pin');
const scratch=newTestScratch('728-reader-census');
const replace=(source:string,from:string,to:string)=>{assert.equal(source.split(from).length,2,'unique instrumentation anchor: '+from.slice(0,80));return source.replace(from,to);};
try{
  copyModuleClosure(['tooling/gate/owed.mjs'],scratch,{sourceRoot:root});
  symlinkSync(join(root,'node_modules'),join(scratch,'node_modules'));
  let source=readFileSync(join(scratch,'tooling/gate/owed.mjs'),'utf8');
  source='export const legacyReferences=new Map();\n'+source;
  if(process.argv.includes('--full'))source+=`\nexport function collectInvestigationCensus(){return collectFullGateCensus(trackedFiles(),path=>{const rules=owed([{path,added:false}]);return {full:rules.some(rule=>rule.full),reasons:rules.filter(rule=>rule.full).map(rule=>rule.name),policyReasons:rules.filter(rule=>rule.full&&!rule.fallback).map(rule=>rule.name)};},inputDirectoryDeclarations());}\n`;
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
  const engines=[];
  for(const [name,disabled]of [['before',false],['after',true]]as const){
    const file=join(scratch,'tooling/gate/owed-'+name+'.mjs');
    writeFileSync(file,'const NO_MODULE_TEXT='+disabled+';\n'+source);
    const owner=await import(pathToFileURL(file).href),map=owner.stepInputs();
    const full=owner.collectInvestigationCensus?.();
    if(full)writeFileSync(new URL('./'+name+'-full.json',output),JSON.stringify(full,null,2)+'\n');
    engines.push({name,owner,map});
    console.log(JSON.stringify({engine:name,prefixes:map.size,legacyReaders:owner.legacyReferences.size}));
  }
  const [before,after]=engines;
  const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',maxBuffer:64<<20}).split('\0').filter(Boolean);
  const sites:any[]=[],targets=new Map<string,any[]>();
  for(const [reader,groups]of before!.owner.legacyReferences){
    for(const [kind,rows]of Object.entries(groups) as [string,any[]][]){
      for(const row of rows){
        const site={reader,kind,literal:row.literal,targets:row.targets,steps:[...before!.owner.covering(before!.map,reader)].sort(),retainedSteps:[...after!.owner.covering(after!.map,reader)].sort(),lost:0};
        sites.push(site);
        for(const target of row.targets){const list=targets.get(target)??[];list.push(site);targets.set(target,list);}
      }
    }
  }
  const lost:any[]=[],byStep:Record<string,number>={},missing:any[]=[];
  for(const path of files){
    const next=after!.owner.covering(after!.map,path);
    for(const step of before!.owner.covering(before!.map,path))if(!next.has(step)){
      const provenance=new Set<any>();
      for(let prefix=path;;){
        for(const site of targets.get(prefix)??[])if(site.steps.includes(step))provenance.add(site);
        const slash=prefix.lastIndexOf('/');if(slash<0)break;prefix=prefix.slice(0,slash);
      }
      const sources=[...provenance].map(site=>{site.lost++;return sites.indexOf(site);});
      const edge={path,step,sources};lost.push(edge);byStep[step]=(byStep[step]??0)+1;
      if(!sources.length)missing.push(edge);
    }
  }
  const readerSummary=new Map<string,{reader:string;sites:number;lost:number;targets:Set<string>}>();
  for(const site of sites){if(!site.lost)continue;let row=readerSummary.get(site.reader);if(!row){row={reader:site.reader,sites:0,lost:0,targets:new Set()};readerSummary.set(site.reader,row);}row.sites++;row.lost+=site.lost;for(const target of site.targets)row.targets.add(target);}
  const readers=[...readerSummary.values()].map(row=>({...row,targets:[...row.targets]})).sort((a,b)=>b.lost-a.lost);
  writeFileSync(new URL('./provenance.json',output),JSON.stringify({sites,lost,missing},null,2)+'\n');
  writeFileSync(new URL('./readers.json',output),JSON.stringify(readers,null,2)+'\n');
  for(const engine of engines)writeFileSync(new URL('./'+engine.name+'-prefixes.json',output),JSON.stringify([...engine.map].map(([path,steps])=>[path,[...steps]]))+'\n');
  writeFileSync(new URL('./summary.json',output),JSON.stringify({source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),tracked:files.length,lostEdges:lost.length,lostPaths:new Set(lost.map(row=>row.path)).size,sites:sites.length,contributingSites:sites.filter(site=>site.lost).length,readers:readers.length,withoutProvenance:missing.length,byStep},null,2)+'\n');
  console.log(JSON.stringify({lostEdges:lost.length,lostPaths:new Set(lost.map(row=>row.path)).size,sites:sites.length,readers:readers.length,withoutProvenance:missing.length,byStep}));
}finally{removable(scratch);rmSync(scratch,{recursive:true,force:true});}
