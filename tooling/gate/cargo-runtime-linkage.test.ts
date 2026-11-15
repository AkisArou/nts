import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cargoRuntimeLinkage,cargoRuntimeRoots,type CargoRuntimeLinkage} from './cargo-inputs.ts';
import {cargoRustRuntimeTargets} from './rust-runtime-declarations.ts';

function fixture(){
  type Dependency={name:string;kind:'dev'|'build'|null;path?:string;rename?:string;target?:string|null};
  const target=(directory:string,kind:string[],name=directory,test=false)=>({name,kind,src_path:'/source/'+directory+(kind.includes('lib')?'/lib.rs':kind.includes('bin')?'/main.rs':'/tests.rs'),test,doctest:false});
  const dependency=(name:string,kind:'dev'|'build'|null=null,rename?:string):Dependency=>({name,kind,path:'/source/'+name,...(rename?{rename}:{})});
  const packages:{id:string;name:string;manifest_path:string;targets:ReturnType<typeof target>[];dependencies:Dependency[]}[]=[
    {id:'app',name:'app',manifest_path:'/source/app/Cargo.toml',targets:[target('app',['lib']),target('app',['bin'],'app-bin'),target('app',['test'],'integration',true)],dependencies:[dependency('normal',null,'renamed_normal'),dependency('dev','dev'),dependency('build','build')]},
    {id:'normal',name:'normal',manifest_path:'/source/normal/Cargo.toml',targets:[target('normal',['lib'])],dependencies:[dependency('nested'),dependency('dependency-dev','dev'),dependency('build','build')]},
    {id:'dev',name:'dev',manifest_path:'/source/dev/Cargo.toml',targets:[target('dev',['lib'])],dependencies:[dependency('nested')]},
    ...['nested','dependency-dev','build'].map(name=>({id:name,name,manifest_path:'/source/'+name+'/Cargo.toml',targets:[target(name,['lib'])],dependencies:[]})),
  ];
  const nodes=packages.map(row=>({id:row.id,deps:row.dependencies.map(dependency=>({name:(dependency.rename??dependency.name).replace(/-/g,'_'),pkg:dependency.name,dep_kinds:[{kind:dependency.kind,target:null as string|null}]}))}));
  return {version:1,workspace_members:packages.map(row=>row.id),packages,resolve:{nodes}};
}
test('the one Cargo response retains disabled library identities and phase-specific dependency routes',()=>{
  const metadata=fixture();let calls=0;
  const linkage=cargoRuntimeLinkage('/source',(command,args)=>{calls++;assert.equal(command,'cargo');assert.deepEqual(args,['metadata','--format-version','1','--offline']);return JSON.stringify(metadata);});
  assert.equal(calls,1);assert.deepEqual([...cargoRustRuntimeTargets(metadata,'/source').values()].flat().map(row=>row.source),['app/tests.rs']);
  const roots=cargoRuntimeRoots(linkage,'app/tests.rs');
  assert.deepEqual([...new Set(roots.map(row=>row.target.source))].sort(),['app/lib.rs','app/main.rs','app/tests.rs','dev/lib.rs','nested/lib.rs','normal/lib.rs']);
  assert.ok(roots.some(row=>row.reason==='same-package-library'&&row.target.source==='app/lib.rs'));
  assert.ok(roots.some(row=>row.reason==='test-binary'&&row.target.source==='app/main.rs'));
  assert.ok(roots.some(row=>row.reason==='dev'&&row.target.source==='dev/lib.rs'));
  assert.ok(roots.some(row=>row.reason==='normal'&&row.target.source==='normal/lib.rs'));
  assert.equal(linkage.packages[0]!.dependencies[0]!.rename,'renamed_normal');
  assert.ok(!roots.some(row=>row.target.source.includes('dependency-dev')||row.target.source.includes('build/')));
  roots[0]!.target.kind.push('mutated');assert.deepEqual(cargoRuntimeRoots(linkage,'app/tests.rs')[0]!.target.kind,['test']);
});
test('runtime composition refuses missing, mismatched and ambiguous linked owners',()=>{
  const metadata=fixture();metadata.packages[0]!.dependencies[0]!.name='different-package';
  assert.throws(()=>cargoRuntimeLinkage('/source',()=>JSON.stringify(metadata)),/no matching declaration/);
  const missing=fixture();missing.packages[0]!.dependencies[0]!.path='/source/missing';
  assert.throws(()=>cargoRuntimeLinkage('/source',()=>JSON.stringify(missing)),/no matching declaration/);
  const linkage=cargoRuntimeLinkage('/source',()=>JSON.stringify(fixture()));
  const owner=linkage.packages.find(row=>row.name==='normal')!;owner.targets=[];
  assert.throws(()=>cargoRuntimeRoots(linkage,'app/tests.rs'),/0 library owners: normal/);
  owner.targets=[{source:'normal/a.rs',name:'a',kind:['lib']},{source:'normal/b.rs',name:'b',kind:['rlib']}];
  assert.throws(()=>cargoRuntimeRoots(linkage,'app/tests.rs'),/2 library owners: normal/);
});
test('resolved in-root nonmembers and patched packages link without becoming workspace test targets',()=>{
  const metadata=fixture(),base=metadata.packages[1]!,vendor=structuredClone(base),patched=structuredClone(base),external=structuredClone(base);
  vendor.id='vendor';vendor.name='vendor';vendor.manifest_path='/source/vendor/Cargo.toml';vendor.targets=[{...base.targets[0]!,name:'vendor_custom',src_path:'/source/vendor/lib.rs',test:true}];vendor.dependencies=[];
  patched.id='patched';patched.name='patched';patched.manifest_path='/source/patched/Cargo.toml';patched.targets=[{...base.targets[0]!,name:'patched',src_path:'/source/patched/lib.rs',test:true}];patched.dependencies=[];
  external.id='external';external.name='external';external.manifest_path='/registry/external/Cargo.toml';external.targets=[{...base.targets[0]!,name:'external',src_path:'/registry/external/lib.rs',test:true}];external.dependencies=[];
  metadata.packages.push(vendor,patched,external);
  metadata.packages[0]!.dependencies.push({name:'vendor',kind:null,path:'/source/vendor'},{name:'patched',kind:null,rename:'patched_alias'},{name:'external',kind:null});
  metadata.resolve.nodes[0]!.deps.push({name:'vendor_custom',pkg:'vendor',dep_kinds:[{kind:null,target:null}]},{name:'patched_alias',pkg:'patched',dep_kinds:[{kind:null,target:'cfg(unix)'}]},{name:'external',pkg:'external',dep_kinds:[{kind:null,target:null}]});
  Object.assign(metadata.packages[0]!.dependencies.at(-2)!,{target:'cfg(unix)'});
  for(const id of ['vendor','patched','external'])metadata.resolve.nodes.push({id,deps:[]});
  const linkage=cargoRuntimeLinkage('/source',()=>JSON.stringify(metadata)),sources=cargoRuntimeRoots(linkage,'app/tests.rs').map(row=>row.target.source);
  assert.ok(sources.includes('vendor/lib.rs'));assert.ok(sources.includes('patched/lib.rs'));assert.ok(!sources.some(row=>row.includes('external')));
  assert.ok(linkage.packages[0]!.dependencies.some(row=>row.name==='patched'&&row.rename==='patched_alias'&&row.target==='cfg(unix)'));
  assert.deepEqual([...cargoRustRuntimeTargets(metadata,'/source').values()].flat().map(row=>row.source),['app/tests.rs']);
});
test('library linking terminates on dependency cycles without inheriting standalone harnesses',()=>{
  const linkage:CargoRuntimeLinkage={packages:[
    {directory:'a',name:'a',targets:[{source:'a/lib.rs',name:'a',kind:['lib']},{source:'a/tests.rs',name:'integration',kind:['test']}],dependencies:[{directory:'b',name:'b',kind:'normal'}]},
    {directory:'b',name:'b',targets:[{source:'b/lib.rs',name:'b',kind:['lib']},{source:'b/tests.rs',name:'integration',kind:['test']}],dependencies:[{directory:'a',name:'a',kind:'normal'}]},
  ]};
  assert.deepEqual([...new Set(cargoRuntimeRoots(linkage,'a/tests.rs').map(row=>row.target.source))].sort(),['a/lib.rs','a/tests.rs','b/lib.rs']);
});
