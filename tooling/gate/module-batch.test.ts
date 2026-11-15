import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {testScratch} from './test-scratch.ts';
import {moduleGraph,type ModuleDescriptionRequest,type ByteInputDeclaration} from './module-closure.ts';
import {fixtureInput,type ModuleDeclarations} from './reader-inputs/main.ts';

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
  }finally{owner.close();}
});
