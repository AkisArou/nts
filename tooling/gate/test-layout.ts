// Cargo targets own harnesses; each harness owns its case files. Test bodies
// stay at their paths. The compiled --list inventory proves a layout change
// preserves every test identity and its multiplicity, including nested tests.
import{spawnSync}from'node:child_process';
import{existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync}from'node:fs';
import{basename,dirname,join,relative,resolve}from'node:path';
import{fileURLToPath,pathToFileURL}from'node:url';
import{inspectRustPidPaths}from'./rust-test-paths.ts';

export const CORE_TEST_TOPICS=['scalars','numbers','strings','arrays','collections','erasure','interfaces','classes',
  'signatures','dispatch','control','memory','ranges','providers','lowering','modules'] as const;
export type CargoTarget={name:string;kind:string[];src_path:string};
export type CargoPackage={id:string;name:string;manifest_path:string;targets:CargoTarget[]};
export type CaseModule={name:string;file:string};
export type TestHarness={crate:string;name:string;file:string;cases:CaseModule[];helpers:CaseModule[]};
export type TestLayout={harnesses:TestHarness[];problems:string[]};
export type InventoryRow={crate:string;kind:string;file:string;name:string;multiplicity:number};
export type TestInventory={version:1;rows:InventoryRow[]};
type Artifact={reason:string;package_id:string;executable?:string;profile:{test:boolean};target:CargoTarget};
const normalize=(path:string)=>path.replaceAll('\\','/');
const sections=(text:string)=>text.split(/(?=^\[)/m);
const modulePattern=/#\[path\s*=\s*"([^"\n]+)"\]\s*mod\s+([A-Za-z_]\w*)\s*;/g;

export function cargoPackages(root:string):CargoPackage[]{
  const ran=spawnSync('cargo',['metadata','--no-deps','--offline','--locked','--format-version','1'],{cwd:root,encoding:'utf8'});
  if(ran.error||ran.status!==0)throw Error('test layout cargo metadata: '+(ran.stderr||ran.error?.message||ran.status));
  const value=JSON.parse(ran.stdout) as {packages?:CargoPackage[]};
  if(!Array.isArray(value.packages)||value.packages.some(pkg=>typeof pkg.id!=='string'||typeof pkg.name!=='string'||typeof pkg.manifest_path!=='string'||!Array.isArray(pkg.targets)))throw Error('invalid test layout package metadata');
  return value.packages;
}

export function checkTestLayout(root:string,packages:readonly CargoPackage[]):TestLayout{
  const harnesses:TestHarness[]=[],problems:string[]=[];
  for(const pkg of packages){
    const directory=dirname(pkg.manifest_path),tests=join(directory,'tests');
    const targets=pkg.targets.filter(target=>target.kind.includes('test'));
    const files=existsSync(tests)?readdirSync(tests,{withFileTypes:true}).filter(file=>file.isFile()&&file.name.endsWith('.rs')).map(file=>file.name):[];
    if(!targets.length&&!files.length)continue;
    const manifest=readFileSync(pkg.manifest_path,'utf8'),parts=sections(manifest);
    const packageSection=parts.find(part=>part.startsWith('[package]'))??'';
    if(!/^autotests\s*=\s*false\s*(?:#.*)?$/m.test(packageSection))problems.push(pkg.name+': package must set autotests = false');
    const wanted=pkg.name==='nts-core'?CORE_TEST_TOPICS.map(topic=>'integration_'+topic):['integration'];
    const declared=parts.filter(part=>part.startsWith('[[test]]')).map(part=>{
      const fields=part.split('\n').slice(1).map(line=>line.replace(/\s*#.*$/,'').trim()).filter(Boolean);
      const name=/^name\s*=\s*"([^"]+)"$/m.exec(fields.join('\n'))?.[1];
      const path=/^path\s*=\s*"([^"]+)"$/m.exec(fields.join('\n'))?.[1];
      if(!name||!path||fields.length!==2)problems.push(pkg.name+': each [[test]] declares only its name and path');
      return {name,path};
    });
    const same=(names:readonly (string|undefined)[])=>JSON.stringify([...names].sort())===JSON.stringify([...wanted].sort());
    if(!same(declared.map(target=>target.name))||!same(targets.map(target=>target.name)))problems.push(pkg.name+': expected explicit harness targets '+wanted.join(', '));
    const owned=new Map<string,number>(),entries=new Set<string>();
    for(const target of targets){
      const file=normalize(relative(root,target.src_path)),expected=join(tests,target.name+'.rs');
      const declaration=declared.find(item=>item.name===target.name);
      if(!wanted.includes(target.name)||resolve(target.src_path)!==resolve(expected)||declaration?.path!=='tests/'+target.name+'.rs'){
        problems.push(pkg.name+': unexpected Cargo test target '+target.name);continue;
      }
      entries.add(basename(target.src_path));
      const source=readFileSync(target.src_path,'utf8').replace(/\/\/[^\n]*/g,'');
      const cases:CaseModule[]=[],helpers:CaseModule[]=[],names=new Set<string>();
      for(const match of source.matchAll(modulePattern)){
        const path=match[1]!,name=match[2]!;
        if(names.has(name))problems.push(file+': module '+name+' is declared twice');names.add(name);
        const resolved=resolve(tests,path),helperFile=normalize(relative(root,resolved));
        if(path.includes('/')){
          const localHelper=resolved.startsWith(resolve(tests)+'/')&&normalize(relative(tests,resolved)).includes('/');
          if(helperFile.startsWith('../')||!localHelper&&!/(?:^|\/)test-support\/.+\.rs$/.test(helperFile)||!existsSync(resolved))
            problems.push(file+': shared helper must be an existing test-support source: '+path);
          if(helpers.some(helper=>helper.file===helperFile))problems.push(file+': shared helper is compiled twice: '+path);
          helpers.push({name,file:helperFile});continue;
        }
        if(!/^[A-Za-z_]\w*\.rs$/.test(path)||name!==basename(path,'.rs')){
          problems.push(file+': case path and module must have the same plain file name');continue;
        }
        const caseFile=normalize(relative(root,join(tests,path)));
        owned.set(path,(owned.get(path)??0)+1);cases.push({name,file:caseFile});
        if(!files.includes(path))problems.push(file+': missing case '+path);
      }
      if(source.replace(modulePattern,'').trim()||!cases.length)problems.push(file+': harness contains only unconditional #[path] case modules');
      harnesses.push({crate:pkg.name,name:target.name,file,cases,helpers});
    }
    for(const file of files){
      const count=owned.get(file)??0;
      if(entries.has(file)){if(count)problems.push(pkg.name+': a harness cannot also be a case: '+file);continue;}
      if(count!==1)problems.push(pkg.name+': case '+file+' has '+count+' owners (expected one)');
    }
  }
  return {harnesses,problems};
}

export function assertTestLayout(root:string,packages:readonly CargoPackage[]=cargoPackages(root)):TestLayout{
  const layout=checkTestLayout(root,packages);
  const listed=spawnSync('git',['ls-files','-z','--','*.rs'],{cwd:root,encoding:'utf8'});
  if(listed.error||listed.status!==0)throw Error('Rust test resource inventory: '+(listed.stderr||listed.error?.message||listed.status));
  const owned=packages.map(pkg=>normalize(relative(root,dirname(pkg.manifest_path)))+'/');
  for(const file of listed.stdout.split('\0').filter(Boolean)){
    if(['compiler/test-support/scratch.rs','compiler/test-support/self_test.rs'].includes(file)||(!file.includes('/test-support/')&&!owned.some(directory=>file.startsWith(directory))))continue;
    const source=readFileSync(join(root,file),'utf8');if(!/process\s*::\s*id|getpid|\{pid|current_exe|--exact/.test(source))continue;
    for(const site of inspectRustPidPaths(file,source).selfSpawns)if(site.test)layout.problems.push(file+':'+site.line+': use the self_test owner for an exact self-spawn and its libtest count');
    for(const site of inspectRustPidPaths(file,source).paths)if(site.test)layout.problems.push(file+':'+site.line+': test resource is keyed by a process ID; use a per-test scratch owner');
  }
  if(layout.problems.length)throw Error(layout.problems.join('\n'));
  return layout;
}

const rowKey=(row:InventoryRow)=>JSON.stringify([row.crate,row.kind,row.file,row.name]);
export function compareInventories(before:TestInventory,after:TestInventory):string[]{
  const counts=(inventory:TestInventory)=>{
    if(inventory.version!==1||!Array.isArray(inventory.rows))throw Error('invalid Rust test inventory');
    const result=new Map<string,number>();
    for(const row of inventory.rows){
      if(![row.crate,row.kind,row.file,row.name].every(value=>typeof value==='string')||!Number.isSafeInteger(row.multiplicity)||row.multiplicity<=0)throw Error('invalid Rust test identity');
      const key=rowKey(row);result.set(key,(result.get(key)??0)+row.multiplicity);
    }return result;
  };
  const old=counts(before),now=counts(after),problems:string[]=[];
  for(const key of new Set([...old.keys(),...now.keys()]))if((old.get(key)??0)!==(now.get(key)??0))problems.push(key+': '+(old.get(key)??0)+' -> '+(now.get(key)??0));
  return problems;
}

export function listedTestRows(root:string,pkg:CargoPackage,target:CargoTarget,listed:string,layout:TestLayout):InventoryRow[]{
  const file=normalize(relative(root,target.src_path)),harness=layout.harnesses.find(item=>item.file===file),rows:InventoryRow[]=[];
  for(const line of listed.split('\n')){
    const match=/^(.*): (?:test|benchmark)$/.exec(line);if(!match)continue;
    let name=match[1]!,caseFile=file;
    if(harness){
      const at=name.indexOf('::'),owner=harness.cases.find(item=>item.name===name.slice(0,at));
      if(at<0||!owner)throw Error(harness.name+': test has no case owner: '+name);
      caseFile=owner.file;name=name.slice(at+2);
    }
    rows.push({crate:pkg.name,kind:target.kind.join(','),file:caseFile,name,multiplicity:1});
  }return rows;
}

export function compiledTestInventory(root:string,packages:readonly CargoPackage[],layout:TestLayout,buildJson:string):TestInventory{
  const artifacts=new Map<string,Artifact>();
  for(const line of buildJson.trim().split('\n')){
    const row=JSON.parse(line) as Artifact;
    if(row.reason==='compiler-artifact'&&row.executable&&row.profile.test)artifacts.set(row.executable,row);
  }
  if(!artifacts.size)throw Error('Rust test inventory contains no compiled binaries');
  const rows:InventoryRow[]=[];
  for(const [binary,artifact] of artifacts){
    const pkg=packages.find(item=>item.id===artifact.package_id);if(!pkg)throw Error('unknown test package '+artifact.package_id);
    const listed=spawnSync(binary,['--list','--format','terse'],{cwd:root,encoding:'utf8'});
    if(listed.error||listed.status!==0)throw Error('cannot list '+binary+': '+(listed.stderr||listed.error?.message||listed.status));
    rows.push(...listedTestRows(root,pkg,artifact.target,listed.stdout,layout));
  }
  return {version:1,rows:rows.sort((a,b)=>rowKey(a).localeCompare(rowKey(b)))};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    const root=fileURLToPath(new URL('../..',import.meta.url)),packages=cargoPackages(root),layout=assertTestLayout(root,packages);
    const args=process.argv.slice(2),option=(name:string)=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
    for(let index=0;index<args.length;index+=2)if(!['--inventory','--output','--compare'].includes(args[index]!)||!args[index+1])throw Error('usage: test-layout.ts [--inventory <cargo-jsonl> --output <json> [--compare <json>]]');
    const input=option('--inventory'),output=option('--output'),comparison=option('--compare');
    if(input||output||comparison){
      if(!input||!output)throw Error('inventory needs both --inventory and --output');
      const inventory=compiledTestInventory(root,packages,layout,readFileSync(input,'utf8'));
      mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(inventory,null,2)+'\n');
      if(comparison){const problems=compareInventories(JSON.parse(readFileSync(comparison,'utf8')) as TestInventory,inventory);if(problems.length)throw Error('Rust test inventory changed:\n'+problems.join('\n'));}
      console.log('Rust test inventory: '+inventory.rows.length+' identities'+(comparison?', exactly preserved':''));
    }
    console.log('Rust integration layout: '+layout.harnesses.length+' harnesses, '+layout.harnesses.reduce((count,harness)=>count+harness.cases.length,0)+' case files');
  }catch(error){console.error(String(error));process.exitCode=1;}
}
