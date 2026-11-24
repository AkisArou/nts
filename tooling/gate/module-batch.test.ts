import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chmodSync,mkdirSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {queryObjects} from 'node:v8';
import {pathToFileURL} from 'node:url';
import {testScratch} from './test-scratch.ts';
import {moduleGraph,type ModuleDescriptionRequest,type ByteInputDeclaration,type ReaderObservation} from './module-closure.ts';
import {fixtureInput,type ModuleDeclarations} from './reader-inputs/main.ts';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';
import {createRequire} from 'node:module';
import {rustSelectorRoles} from './rust-selector-roles.ts';
import {readerBatchValidation} from './reader-observations.ts';
import {captureToolchain,toolchainDescriptor} from '../differential/oracle-toolchain.ts';
import {readHostObservation} from '../differential/oracle-filesystem.ts';
import {selectorInstalledSdk} from './rust-selector-inputs.ts';

test('Program identity capture belongs to its transaction, independently of reader and target count',t=>{
  const root=testScratch(t,'module-batch-capture-count');
  writeFileSync(join(root,'package.json'),'{"type":"module"}');
  writeFileSync(join(root,'tsconfig.json'),'{"compilerOptions":{"types":[],"noLib":true},"files":["main.ts"]}');
  writeFileSync(join(root,'main.ts'),"export {value} from './later.js';");
  const declarations=new Map<string,ModuleDeclarations>();
  const requests=Array.from({length:12},(_,index)=>{
    const name='reader-'+index+'.rs';writeFileSync(join(root,name),'');
    declarations.set(name,{imports:[],assets:[{kind:'project-config',role:'compiled-program',path:'./tsconfig.json'}]});
    return {entries:[name]};
  });
  let physical=0,programs=0;
  const identity=OracleFilesystem.prototype.inputIdentity;
  t.mock.method(OracleFilesystem.prototype,'inputIdentity',function(this:OracleFilesystem,...args:Parameters<typeof identity>){
    if(args[1]===root)physical++;return identity.apply(this,args);
  });
  const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync');
  const acquire=Object.getOwnPropertyDescriptor(API.prototype,'createProgram')!.get!;
  t.mock.getter(API.prototype,'createProgram',function(this:import('typescript/sync').API){
    const native=acquire.call(this) as import('typescript/sync').API['createProgram'];
    const counted=Object.assign((...args:Parameters<typeof native>)=>{programs++;return native(...args);},native);
    Object.defineProperty(this,'createProgram',{value:counted,configurable:true});return counted;
  });
  const graph=moduleGraph({sourceRoot:root,declarations});
  try{
    graph.describeBatch(requests.slice(0,1));
    const one=physical;assert.ok(one>0);assert.equal(programs,1);
    physical=0;programs=0;
    const results=graph.describeBatch(requests);
    assert.equal(programs,1,'one fresh native Program for the complete repeated request');
    assert.equal(physical,one,'more readers and targets compose detached facts without physical recapture');
    for(const [index,result]of results.entries()){
      assert.ok(result.snapshot.observations.some(row=>row.reader==='reader-'+index+'.rs'));
      assert.ok(!result.snapshot.moduleFiles.includes('later.ts'));
    }
    const original=structuredClone(results[1]);results[0]!.snapshot.observations[0]!.observation.value=null;
    assert.deepEqual(results[1],original,'returned target facts stay independently mutable');
    writeFileSync(join(root,'later.ts'),'export const value=1;');programs=0;
    assert.ok(graph.describeBatch(requests).every(result=>result.snapshot.moduleFiles.includes('later.ts')));
    assert.equal(programs,1,'a later scope constructs a fresh Program and observes the formerly missing source');
  }finally{graph.close();}
});

test('batch snapshots and byte reports equal separate canonical visitors with target provenance',t=>{
  const root=testScratch(t,'module-batch-equality');
  writeFileSync(join(root,'package.json'),'{"type":"module"}');
  writeFileSync(join(root,'tsconfig.json'),'{"compilerOptions":{"types":[]},"files":["main.ts"]}');
  writeFileSync(join(root,'main.ts'),'export const value=1;');
  const declarations=new Map<string,ModuleDeclarations>();
  for(const name of ['first.rs','second.rs']){
    writeFileSync(join(root,name),'');
    declarations.set(name,{imports:[],assets:[{kind:'project-config',role:'compiled-program',path:'./tsconfig.json'},{kind:'optional-file',path:'./later.json'}]});
  }
  const requests=['first.rs','second.rs'].map(name=>({entries:[name]})),separate=moduleGraph({sourceRoot:root,declarations});
  let expected;
  try{expected=requests.map(request=>{const byteInputs:ByteInputDeclaration[]=[];return {snapshot:separate.describe(request.entries,undefined,row=>byteInputs.push(row)),byteInputs};});}
  finally{separate.close();}
  const owner=moduleGraph({sourceRoot:root,declarations});
  try{
    const actual=owner.describeBatch(requests);assert.deepEqual(actual,expected);
    assert.ok(actual[0]!.snapshot.observations.some(row=>row.reader==='first.rs'));
    assert.ok(actual[1]!.snapshot.observations.some(row=>row.reader==='second.rs'));
    const before=structuredClone(actual[1]!);
    actual[0]!.snapshot.observations[0]!.observation.value=null;
    actual[0]!.snapshot.files.push('mutated');actual[0]!.byteInputs[0]!.path='mutated';
    assert.deepEqual(actual[1],before,'target rows do not share mutable return values');
    writeFileSync(join(root,'later.json'),'{}');
    writeFileSync(join(root,'main.ts'),'export const changed=2;');
    const next=owner.describeBatch(requests);
    assert.ok(next.every(row=>row.snapshot.optionalFiles[0]!.present));
    assert.notDeepEqual(next[0]!.snapshot.observations,before.snapshot.observations);
  }finally{owner.close();}
  assert.throws(()=>owner.describeBatch(requests),/closed/);
});

test('batch refuses mutations between identical requests and clears failed discovery state',t=>{
  for(const change of ['source','package','membership','negative'] as const){
    const root=testScratch(t,'module-batch-'+change);
    const put=(name:string,body:string)=>writeFileSync(join(root,name),body);
    put('package.json','{"name":"self","type":"module","exports":{".":"./first.ts"}}');
    put('first.ts','export const value=1;');put('second.ts','export const value=2;');
    mkdirSync(join(root,'src'));
    put('entry.ts',"import './src/missing.js';import {value} from 'self';export {value};");
    put('tsconfig.json','{"compilerOptions":{"module":"nodenext","moduleResolution":"nodenext","types":[]},"include":["*.ts"]}');
    put('reader.rs','');
    const declarations=new Map<string,ModuleDeclarations>([['reader.rs',{imports:[],assets:[{kind:'project-config',role:'compiled-program',path:'./tsconfig.json'}]}]]);
    const owner=moduleGraph({sourceRoot:root,declarations});
    let changed=false,returned=false;
    const request:ModuleDescriptionRequest={get entries(){
      assert.throws(()=>owner.describeBatch([]),/active batch/);
      assert.throws(()=>owner.close(),/active batch/);
      changed=true;
      if(change==='source')put('entry.ts',"import {value} from 'self';export const changed=value;");
      if(change==='package')put('package.json','{"name":"self","type":"module","exports":{".":"./second.ts"}}');
      if(change==='membership')put('appeared.ts','export {};');
      if(change==='negative')put('src/missing.ts','export {};');
      return ['reader.rs'];
    }};
    try{
      assert.throws(()=>{owner.describeBatch([{entries:['reader.rs']},request]);returned=true;},/changed/);
      assert.ok(changed);assert.equal(returned,false);
      const fresh=owner.describeBatch([{entries:['reader.rs']}]);assert.equal(fresh.length,1);
      if(change==='membership')assert.ok(fresh[0]!.snapshot.files.includes('appeared.ts'));
      if(change==='negative')assert.ok(fresh[0]!.snapshot.moduleFiles.includes('src/missing.ts'));
      if(change==='package')assert.ok(fresh[0]!.snapshot.observations.some(row=>row.observation.kind==='file'&&row.observation.path===join(root,'package.json')));
    }finally{owner.close();}
  }
});

test('generated batch discoveries key the full recipe and namespace and retain private ConfigDirs',t=>{
  const root=testScratch(t,'module-batch-generated'),parent=testScratch(t,'module-batch-private');
  mkdirSync(join(root,'case'));writeFileSync(join(root,'case/main.ts'),'export {};');
  writeFileSync(join(root,'package.json'),'{"type":"module"}');
  writeFileSync(join(root,'base.json'),'{"compilerOptions":{"types":[]}}');
  writeFileSync(join(root,'reader.rs'),'');writeFileSync(join(root,'tree.rs'),'');
  const declarations=new Map<string,ModuleDeclarations>([
    ['reader.rs',{imports:[],assets:[{kind:'generated-project',role:'compiled-program',path:'./base.json',directory:'./case/',include:'directory'}]}],
    ['tree.rs',{imports:[],assets:[{kind:'generated-project',role:'compiled-program',path:'./base.json',directory:'./case/',include:'typescript-tree'}]}],
  ]);
  const owner=moduleGraph({sourceRoot:root,declarations,generatedTemporaryParent:parent});
  const privateEntry=fixtureInput(pathToFileURL(join(root,'reader.rs')),{dataNamespaces:{}});
  const requests=[{entries:['reader.rs']},{entries:['reader.rs']},{entries:[privateEntry]},{entries:['tree.rs']}];
  const roots=(results:ReturnType<typeof owner.describeBatch>)=>results.map(result=>{
    const row=result.snapshot.observations.find(row=>row.capability?.kind==='generated-project');
    assert.ok(row?.capability?.kind==='generated-project');return row.capability.root;
  });
  try{
    const results=owner.describeBatch(requests),paths=roots(results);
    assert.equal(paths[0],paths[1],'identical discovery has one actual private ConfigDir');
    assert.notEqual(paths[0],paths[2],'fixture context is not production');
    assert.notEqual(paths[0],paths[3],'different include options use a fresh Program');
    assert.equal(results[2]!.snapshot.observations[0]!.context.entry,'reader.rs');
    assert.deepEqual(readdirSync(parent),[],'every generated transaction is closed');
    const next=roots(owner.describeBatch(requests));assert.notEqual(next[0],paths[0],'no discovery survives a call');
    const projected=owner.mapDescriptions(requests,({snapshot,byteInputs})=>({
      root:roots([{snapshot,byteInputs}])[0]!,roles:rustSelectorRoles(root,snapshot,byteInputs)}));
    assert.equal(projected[0]!.root,projected[1]!.root);
    assert.notEqual(projected[0]!.root,projected[2]!.root,'projected fixture and production contexts never alias');
    assert.notEqual(projected[0]!.root,projected[3]!.root,'projected recipes never alias');
    assert.notEqual(projected[0]!.root,paths[0],'projection has a fresh transaction');
    assert.deepEqual(projected.map(row=>row.roles),results.map(({snapshot,byteInputs})=>rustSelectorRoles(root,snapshot,byteInputs)));
    assert.deepEqual(readdirSync(parent),[]);

  }finally{owner.close();}
});

test('adaptive description scopes reject nested, async and escaped use and clear failed state',t=>{
  const root=testScratch(t,'module-adaptive-scope');
  writeFileSync(join(root,'entry.ts'),'export {};');
  const owner=moduleGraph({sourceRoot:root});
  let escaped:typeof owner.describe|undefined;
  try{
    owner.withDescriptions(describe=>{
      escaped=describe;
      assert.ok(describe(['entry.ts']).files.includes('entry.ts'));
      assert.throws(()=>owner.withDescriptions(()=>{}),/active batch/);
      assert.throws(()=>owner.describe(['entry.ts']),/active batch/);
      assert.throws(()=>owner.close(),/active batch/);
    });
    assert.throws(()=>escaped!(['entry.ts']),/scope is closed/);
    assert.throws(()=>owner.withDescriptions(()=>Promise.resolve()),/synchronous/);
    assert.throws(()=>owner.withDescriptions(()=>{throw Error('body refused');}),/body refused/);
    assert.ok(owner.withDescriptions(describe=>describe(['entry.ts'])).files.includes('entry.ts'));
  }finally{owner.close();}
});


test('a scope never shares project reads across committed and working endpoint views',t=>{
  const root=testScratch(t,'module-scope-endpoints');
  for(const configOnly of [false,true]){
    const graphs=[];
    for(const member of ['first','second']){
      const source=join(root,String(configOnly)+'-'+member);mkdirSync(source);
      for(const name of ['first','second'])writeFileSync(join(source,name+'.ts'),'export const value=1;');
      writeFileSync(join(source,'main.ts'),configOnly?'export {};':`export {value} from './${member}.js';`);
      writeFileSync(join(source,'tsconfig.json'),JSON.stringify({compilerOptions:{types:[],noLib:true},files:[configOnly?member+'.ts':'main.ts']}));
      writeFileSync(join(source,'reader.rs'),'');
      const declarations=new Map<string,ModuleDeclarations>([['reader.rs',{imports:[],assets:[{kind:'project-config',role:'compiled-program',path:'./tsconfig.json'}]}]]);
      graphs.push(moduleGraph({sourceRoot:source,declarations}));
    }
    try{
      const answers=graphs.map(graph=>graph.withDescriptions(describe=>describe(['reader.rs'])));
      assert.ok(answers[0]!.moduleFiles.includes('first.ts'));
      assert.ok(!answers[0]!.moduleFiles.includes('second.ts'));
      assert.ok(answers[1]!.moduleFiles.includes('second.ts'));
      assert.ok(!answers[1]!.moduleFiles.includes('first.ts'));
    }finally{for(const graph of graphs)graph.close();}
  }
});

test('scope requests stop immediately after the body, including return inspection and validation',t=>{
  const root=testScratch(t,'module-scope-phases');
  writeFileSync(join(root,'main.ts'),'export {};');
  writeFileSync(join(root,'tsconfig.json'),'{"compilerOptions":{"types":[],"noLib":true},"files":["main.ts"]}');
  writeFileSync(join(root,'reader.rs'),'');
  const declarations=new Map<string,ModuleDeclarations>([['reader.rs',{imports:[],assets:[{kind:'project-config',role:'compiled-program',path:'./tsconfig.json'}]}]]);
  const graph=moduleGraph({sourceRoot:root,declarations});
  let escaped:typeof graph.describe|undefined,inspected=false,validated=false;
  try{
    const result=graph.withDescriptions(describe=>{
      escaped=describe;const snapshot=describe(['reader.rs']);
      const observation=snapshot.observations.find(row=>!row.capability&&!row.environment)!.observation;
      const kind=observation.kind;
      Object.defineProperty(observation,'kind',{get(){
        assert.equal(inspected,true,'the validator runs after return-value inspection');
        assert.throws(()=>describe(['reader.rs']),/scope is closed/,'cached requests cannot bypass validation');
        assert.throws(()=>describe(['main.ts']),/scope is closed/,'new requests cannot bypass validation');
        validated=true;return kind;
      }});
      return {value:'result',get then(){
        assert.throws(()=>describe(['reader.rs']),/scope is closed/,'return-value inspection follows the body phase');
        inspected=true;return undefined;
      }};
    });
    assert.equal(result.value,'result');assert.ok(inspected);assert.ok(validated);
    assert.throws(()=>escaped!(['reader.rs']),/scope is closed/);
    assert.equal(graph.withDescriptions(describe=>describe(['reader.rs'])).moduleFiles.includes('main.ts'),true);
  }finally{graph.close();}
});

test('scope keys include the complete generated recipe, fixture entry and canonical namespace map',t=>{
  const root=testScratch(t,'module-scope-context'),parent=testScratch(t,'module-scope-context-configs');
  for(const name of ['case','alpha','beta'])mkdirSync(join(root,name));
  writeFileSync(join(root,'case/main.ts'),'export {};');
  writeFileSync(join(root,'base.json'),'{"compilerOptions":{"types":[],"noLib":true}}');
  const declarations=new Map<string,ModuleDeclarations>();
  for(const name of ['reader.rs','other.rs']){
    writeFileSync(join(root,name),'');
    declarations.set(name,{imports:[],assets:[{kind:'generated-project',role:'compiled-program',path:'./base.json',directory:'./case/',include:name==='reader.rs'?'directory':'typescript-tree'},
      {kind:'data',path:'./alpha/'},{kind:'data',path:'./beta/'}]});
  }
  const graph=moduleGraph({sourceRoot:root,declarations,generatedTemporaryParent:parent});
  const entry=(name:string,dataNamespaces:Record<string,string>)=>fixtureInput(pathToFileURL(join(root,name)),{dataNamespaces});
  const a=entry('reader.rs',{alpha:'owner-a',beta:'owner-b'}),reordered=entry('reader.rs',{beta:'owner-b',alpha:'owner-a'});
  const changed=entry('reader.rs',{alpha:'another-owner',beta:'owner-b'}),other=entry('other.rs',{alpha:'owner-a',beta:'owner-b'});
  const privateRoot=(snapshot:ReturnType<typeof graph.describe>)=>{
    const row=snapshot.observations.find(row=>row.capability?.kind==='generated-project');
    assert.ok(row?.capability?.kind==='generated-project');return row.capability.root;
  };
  try{
    const roots=graph.withDescriptions(describe=>[a,reordered,changed,other].map(input=>privateRoot(describe([input]))));
    assert.equal(roots[0],roots[1],'namespace insertion order does not start a second Program');
    assert.notEqual(roots[0],roots[2],'namespace ownership changes start a fresh Program');
    assert.notEqual(roots[0],roots[3],'fixture entry and recipe cannot borrow another ConfigDir');
    assert.deepEqual(readdirSync(parent),[],'all real generated transactions are closed');
    const fresh=graph.withDescriptions(describe=>privateRoot(describe([a])));
    assert.notEqual(fresh,roots[0],'no project discovery survives the scope');
  }finally{graph.close();}
});

test('a later scope observes materialized missing inputs and changed config bytes',t=>{
  const root=testScratch(t,'module-scope-fresh');
  writeFileSync(join(root,'main.ts'),"export {value} from './later.js';");
  const config={compilerOptions:{types:[],noLib:true},files:['main.ts']};
  writeFileSync(join(root,'tsconfig.json'),JSON.stringify(config));writeFileSync(join(root,'reader.rs'),'');
  const declarations=new Map<string,ModuleDeclarations>([['reader.rs',{imports:[],assets:[{kind:'project-config',role:'compiled-program',path:'./tsconfig.json'}]}]]);
  const graph=moduleGraph({sourceRoot:root,declarations});
  try{
    assert.ok(!graph.withDescriptions(describe=>describe(['reader.rs'])).moduleFiles.includes('later.ts'));
    writeFileSync(join(root,'later.ts'),'export const value=2;');
    writeFileSync(join(root,'tsconfig.json'),JSON.stringify({...config,files:['main.ts','later.ts']}));
    assert.ok(graph.withDescriptions(describe=>describe(['reader.rs'])).moduleFiles.includes('later.ts'));
  }finally{graph.close();}
});

test('catalog views retain independent unavailable installed-package inputs',t=>{
  const root=testScratch(t,'module-scope-catalog');
  mkdirSync(join(root,'node_modules/dep'),{recursive:true});
  writeFileSync(join(root,'node_modules/dep/package.json'),'{"name":"dep","version":"1.0.0","types":"index.d.ts"}');
  writeFileSync(join(root,'node_modules/dep/index.d.ts'),'export const value:number;');
  writeFileSync(join(root,'main.ts'),"export {value} from 'dep';");
  writeFileSync(join(root,'tsconfig.json'),'{"compilerOptions":{"module":"nodenext","moduleResolution":"nodenext","types":[],"noLib":true},"files":["main.ts"]}');
  writeFileSync(join(root,'reader.rs'),'');
  const declarations=new Map<string,ModuleDeclarations>([['reader.rs',{imports:[],assets:[{kind:'project-config',role:'compiled-program',path:'./tsconfig.json'}]}]]);
  const reasons=[];
  for(const dependencyCatalog of [null,{catalogPath:join(root,'missing.catalog.json'),catalogSha256:'0'.repeat(64)}]){
    const graph=moduleGraph({sourceRoot:root,declarations,dependencyCatalog,unavailableInputs:'conservative'});
    try{
      const answer=graph.withDescriptions(describe=>describe(['reader.rs']));
      const unavailable=answer.unavailableInputs?.find(row=>row.kind==='installed-package-reach');
      assert.ok(unavailable);reasons.push(unavailable.reason);
    }finally{graph.close();}
  }
  assert.deepEqual(reasons,['installation catalog is missing','installation catalog is missing: '+join(root,'missing.catalog.json')]);
});

test('ordinary visitors share discovery while retaining independent reader provenance',t=>{
  const root=testScratch(t,'module-scope-provenance'),parent=testScratch(t,'module-scope-provenance-configs');
  mkdirSync(join(root,'case'));writeFileSync(join(root,'case/main.ts'),'export {};');
  writeFileSync(join(root,'base.json'),'{"compilerOptions":{"types":[],"noLib":true}}');
  const declarations=new Map<string,ModuleDeclarations>();
  for(const name of ['first.rs','second.rs']){
    writeFileSync(join(root,name),'');
    declarations.set(name,{imports:[],assets:[{kind:'generated-project',role:'compiled-program',path:'./base.json',directory:'./case/',include:'directory'}]});
  }
  const graph=moduleGraph({sourceRoot:root,declarations,generatedTemporaryParent:parent});
  try{
    const [first,second]=graph.withDescriptions(describe=>[describe(['first.rs']),describe(['second.rs'])]);
    for(const [snapshot,reader,other]of [[first!,'first.rs','second.rs'],[second!,'second.rs','first.rs']] as const){
      assert.ok(snapshot.observations.some(row=>row.reader===reader));
      assert.ok(!snapshot.observations.some(row=>row.reader===other));
    }
    const roots=[first!,second!].map(snapshot=>{
      const row=snapshot.observations.find(row=>row.capability?.kind==='generated-project');
      assert.ok(row?.capability?.kind==='generated-project');return row.capability.root;
    });
    assert.equal(roots[0],roots[1],'two ordinary visitors share one actual Program request');
  }finally{graph.close();}
});

test('caller row-list processing cannot hide a later input change from the scope end fence',t=>{
  const root=testScratch(t,'module-scope-end-fence');
  const config={compilerOptions:{types:[],noLib:true},files:['main.ts']};
  writeFileSync(join(root,'tsconfig.json'),JSON.stringify(config));writeFileSync(join(root,'main.ts'),'export {};');
  writeFileSync(join(root,'reader.rs'),'');
  const declarations=new Map<string,ModuleDeclarations>([['reader.rs',{imports:[],assets:[{kind:'project-config',role:'compiled-program',path:'./tsconfig.json'}]}]]);
  const graph=moduleGraph({sourceRoot:root,declarations});
  try{
    assert.throws(()=>graph.withDescriptions(describe=>{
      const snapshot=describe(['reader.rs']);snapshot.observations.length=0;
      writeFileSync(join(root,'tsconfig.json'),JSON.stringify({...config,compilerOptions:{...config.compilerOptions,strict:true}}));
    }),/changed/);
    assert.ok(graph.withDescriptions(describe=>describe(['reader.rs'])).files.includes('main.ts'));
  }finally{graph.close();}
});


test('projecting batches retain only the current full snapshot and preserve every consumed role',t=>{
  const root=testScratch(t,'module-projection-lifetime');
  writeFileSync(join(root,'main.ts'),'export const value=1;');
  writeFileSync(join(root,'tsconfig.json'),'{"compilerOptions":{"types":[],"noLib":true},"files":["main.ts"]}');
  const declarations=new Map<string,ModuleDeclarations>();
  const requests=Array.from({length:8},(_,index)=>{
    const reader='reader-'+index+'.rs';writeFileSync(join(root,reader),'');
    declarations.set(reader,{imports:[],assets:[{kind:'project-config',role:'compiled-program',path:'./tsconfig.json'}]});
    return {entries:[reader]};
  });
  class RetainedObservation {}
  const graph=moduleGraph({sourceRoot:root,declarations});
  try{
    const expected=graph.describeBatch(requests).map(({snapshot,byteInputs})=>rustSelectorRoles(root,snapshot,byteInputs));
    const actual=graph.mapDescriptions(requests,({snapshot,byteInputs})=>{
      assert.ok(snapshot.observations.length);
      Object.setPrototypeOf(snapshot.observations[0]!,RetainedObservation.prototype);
      assert.equal(queryObjects(RetainedObservation,{format:'count'}),1,'a projecting batch retains only its current complete snapshot');
      return rustSelectorRoles(root,snapshot,byteInputs);
    });
    assert.deepEqual(actual,expected,'every selector-consumed role and its reader/context provenance matches the canonical visitor');
    assert.equal(queryObjects(RetainedObservation,{format:'count'}),0,'the completed transaction retains no full snapshot');
    const before=structuredClone(actual[1]);actual[0]!.files.push('mutated');assert.deepEqual(actual[1],before,'projected targets remain independently mutable');
  }finally{graph.close();}
});

test('projecting batches refuse source, package, membership and negative changes before publishing',t=>{
  for(const change of ['source','package','membership','negative'] as const){
    const root=testScratch(t,'module-projection-race-'+change);mkdirSync(join(root,'src'));
    const put=(name:string,body:string)=>writeFileSync(join(root,name),body);
    put('package.json','{"name":"self","type":"module","exports":{".":"./first.ts"}}');
    put('first.ts','export const value=1;');put('second.ts','export const value=2;');
    put('entry.ts',"import './src/missing.js';import {value} from 'self';export {value};");
    put('tsconfig.json','{"compilerOptions":{"module":"nodenext","moduleResolution":"nodenext","types":[],"noLib":true},"include":["*.ts"]}');
    put('reader.rs','');
    const declarations=new Map<string,ModuleDeclarations>([['reader.rs',{imports:[],assets:[{kind:'project-config',role:'compiled-program',path:'./tsconfig.json'}]}]]);
    const graph=moduleGraph({sourceRoot:root,declarations});let published=false,visited=0;
    try{
      assert.throws(()=>{
        graph.mapDescriptions([{entries:['reader.rs']},{entries:['reader.rs']}],({snapshot,byteInputs},index)=>{
          visited++;
          if(index===0){
            if(change==='source')put('entry.ts','export const changed=2;');
            if(change==='package')put('package.json','{"name":"self","type":"module","exports":{".":"./second.ts"}}');
            if(change==='membership')put('appeared.ts','export {};');
            if(change==='negative'){
              assert.ok(snapshot.observations.some(row=>row.observation.kind==='fileExists'&&row.observation.path===join(root,'src/missing.ts')&&row.observation.value===false));
              put('src/missing.ts','export {};');
            }
          }
          return rustSelectorRoles(root,snapshot,byteInputs);
        });
        published=true;
      },/changed/,change);
      assert.ok(visited>0);assert.equal(published,false,'a projection has no authority before the whole scope validates');
      const fresh=graph.mapDescriptions([{entries:['reader.rs']}],row=>row.snapshot.moduleFiles);
      if(change==='negative')assert.ok(fresh[0]!.includes('src/missing.ts'));
      if(change==='membership')assert.ok(fresh[0]!.includes('appeared.ts'));
    }finally{graph.close();}
  }
});

test('batch replay refuses a private SDK edit before publication',t=>{
  const root=testScratch(t,'module-projection-sdk'),installed=selectorInstalledSdk();
  const sdk=join(root,'node_modules/typescript'),native=join(root,'node_modules',installed.nativePackage);
  for(const [destination,source,files]of [[sdk,installed.root,installed.files],[native,installed.nativeRoot,installed.nativeFiles]] as const)
    for(const [path,bytes]of files){const file=join(destination,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,bytes);chmodSync(file,statSync(join(source,path)).mode&0o777);}
  const captured=captureToolchain(sdk),file=join(sdk,'package.json');
  const row:ReaderObservation={reader:'reader.rs',protocol:'project',context:{entry:'<entry>',dataNamespaces:{}},
    observation:{kind:'file',path:file,value:readHostObservation('file',file)},capability:toolchainDescriptor(captured),causes:[]};
  const validation=readerBatchValidation(root);let published=false;
  try{
    validation.add({observations:[row],projectMatches:[]});validation.validate();
    const foreign=readerBatchValidation(root);
    try{
      foreign.add({observations:[row,{...row,capability:{...toolchainDescriptor(captured),root:join(root,'absent-sdk')}}],projectMatches:[]});
      assert.throws(()=>foreign.validate(),/absent-sdk|package\.json/,'equal answers never borrow a different authority');
    }finally{foreign.close();}
    writeFileSync(file,readFileSync(file,'utf8')+' ');
    assert.throws(()=>{validation.validate();published=true;},/TypeScript root package hash mismatch/);
    assert.equal(published,false);
  }finally{validation.close();}
  assert.throws(()=>validation.add({observations:[row],projectMatches:[]}),/closed/);
});

test('projection, validation and close failures release every parser, Program and generated owner',t=>{
  const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync');
  type Api=import('typescript/sync').API;
  const acquired=new Set<Api>(),closed=new Map<Api,number>();let injectCloseFailure=false,closeFailed=false;
  for(const method of ['createSourceFile','parseConfigFile'] as const){
    const getter=Object.getOwnPropertyDescriptor(API.prototype,method)!.get!;
    t.mock.getter(API.prototype,method,function(this:Api){acquired.add(this);return getter.call(this);});
  }
  const acquireClose=Object.getOwnPropertyDescriptor(API.prototype,'close')!.get!;
  t.mock.getter(API.prototype,'close',function(this:Api){
    const native=acquireClose.call(this) as Api['close'];
    const counted=Object.assign(()=>{
      closed.set(this,(closed.get(this)??0)+1);native();
      if(injectCloseFailure&&!closeFailed){closeFailed=true;throw Error('supplied SDK close failure');}
    },native);
    Object.defineProperty(this,'close',{value:counted,configurable:true});return counted;
  });
  for(const failure of ['projection','validation','close'] as const){
    const root=testScratch(t,'module-projection-cleanup-'+failure),parent=testScratch(t,'module-projection-generated-'+failure);
    mkdirSync(join(root,'case'));writeFileSync(join(root,'case/main.ts'),'export {};');writeFileSync(join(root,'host.ts'),'export {};');
    writeFileSync(join(root,'base.json'),'{"compilerOptions":{"types":[],"noLib":true}}');writeFileSync(join(root,'reader.rs'),'');
    const declarations=new Map<string,ModuleDeclarations>([['reader.rs',{imports:[],assets:[{kind:'generated-project',role:'compiled-program',path:'./base.json',directory:'./case/',include:'directory'}]}]]);
    const graph=moduleGraph({sourceRoot:root,declarations,generatedTemporaryParent:parent});
    const run=()=>graph.mapDescriptions([{entries:['reader.rs','host.ts']}],({snapshot,byteInputs})=>{
      if(failure==='projection')throw Error('supplied projection failure');
      if(failure==='validation')writeFileSync(join(root,'case/main.ts'),'export const changed=1;');
      return rustSelectorRoles(root,snapshot,byteInputs);
    });
    try{
      if(failure==='close')run();else assert.throws(run,failure==='projection'?/supplied projection failure/:/changed/);
      assert.deepEqual(readdirSync(parent),[],'generated private contexts drain even when projection or validation refuses');
    }finally{
      injectCloseFailure=failure==='close';
      if(injectCloseFailure)assert.throws(()=>graph.close(),/module graph cleanup failed/);else graph.close();
      graph.close();injectCloseFailure=false;
    }
  }
  assert.ok(acquired.size>=6);assert.ok(closeFailed);
  for(const owner of acquired)assert.equal(closed.get(owner),1,'each acquired native owner closes once on every exceptional path');
});
