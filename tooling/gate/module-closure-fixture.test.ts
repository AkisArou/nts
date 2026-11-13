import {fixtureInput,projectInput} from './reader-inputs/main.ts';
import {pathToFileURL} from 'node:url';
import {gitArguments} from "./git-arguments/main.ts";
import assert from "node:assert/strict";
import {existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {test, type TestContext} from "node:test";
import {copyModuleClosure, moduleClosure, FIXTURE_INPUT_MANIFEST} from "./module-closure-fixture.ts";
import {moduleGraph} from './module-closure.ts';
import {spawnTest} from "./test-wait.ts";
import {testScratch} from "./test-scratch.ts";

function fixture(t: TestContext) {
  const root = testScratch(t, "module-closure"), source = join(root, "source"), destination = join(root, "destination");
  mkdirSync(source);
  const write = (name: string, value: string) => {const path = join(source, name); mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, value);};
  return {source, destination, write};
}

function dataFixture(t:TestContext){
  const f=fixture(t);
  f.write('tooling/gate/reader-inputs/main.ts','export const dataDirectory=(url:URL)=>url;');
  f.write('entry.ts',`import {readFileSync} from 'node:fs';
import {dataDirectory} from './tooling/gate/reader-inputs/main.ts';
const data=dataDirectory(new URL('./data/',import.meta.url));
console.log(readFileSync(new URL('case.ts',data),'utf8'));`);
  // This is corpus source, not a module run by the host reader.
  f.write('data/case.ts',"import './not-a-host-input.ts';");
  f.write('data/nested/second.txt','production data');
  for(const args of [['init','--quiet','--initial-branch=main'],['add','.']]){
    const result=spawnTest('git',gitArguments(args),{cwd:f.source,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  }
  return {...f,privateData(){mkdirSync(join(f.destination,'data'),{recursive:true});writeFileSync(join(f.destination,'data/case.ts'),'fixture data');}};
}

test('a declared data directory copies all tracked data without parsing it as host modules',t=>{
  const f=dataFixture(t);f.write('data/untracked.txt','not an input');
  const files=copyModuleClosure(['entry.ts'],f.destination,{sourceRoot:f.source});
  assert.deepEqual(files,['data/case.ts','data/nested/second.txt','entry.ts','tooling/gate/reader-inputs/main.ts']);
  for(const name of files)assert.deepEqual(readFileSync(join(f.destination,name)),readFileSync(join(f.source,name)));
  assert.equal(existsSync(join(f.destination,'data/untracked.txt')),false);
  assert.equal(existsSync(join(f.destination,FIXTURE_INPUT_MANIFEST)),false);
});

test('an exact file input owns bytes without entering imports, and cannot be substituted',t=>{
  const f=dataFixture(t);
  f.write('tooling/gate/reader-inputs/main.ts','export const dataDirectory=(url:URL)=>url;export const fileInput=(url:URL)=>url;');
  f.write('bytes.ts',"import {fileInput} from './tooling/gate/reader-inputs/main.ts';fileInput(new URL('./data/case.ts',import.meta.url));");
  const graph=moduleGraph({sourceRoot:f.source});
  try{
    const result=graph.describe(['bytes.ts']);
    assert.ok(result.files.includes('data/case.ts'));
    assert.ok(result.ownedFiles.includes('data/case.ts'));
    assert.ok(!result.moduleFiles.includes('data/case.ts'),'a text read never enters its import-shaped content');
  }finally{graph.close();}
  copyModuleClosure(['bytes.ts'],f.destination,{sourceRoot:f.source});
  assert.deepEqual(readFileSync(join(f.destination,'data/case.ts')),readFileSync(join(f.source,'data/case.ts')));
  f.privateData();
  assert.throws(()=>copyModuleClosure(['entry.ts','bytes.ts'],f.destination,{sourceRoot:f.source,dataNamespaces:{data:'private cases'}}),/cannot replace module-owned input: data\/case.ts/);
});

test('a later module edge enters an earlier file input, in either entry order',t=>{
  const f=fixture(t);
  f.write('tooling/gate/reader-inputs/main.ts','export const fileInput=(url:URL)=>url;');
  f.write('bytes.ts',"import {fileInput} from './tooling/gate/reader-inputs/main.ts';fileInput(new URL('./shared.ts',import.meta.url));");
  f.write('entry.ts',"import './shared.ts';");
  f.write('shared.ts',"import './dependency.ts';");f.write('dependency.ts','export const answer=1;');
  for(const entries of [['bytes.ts','entry.ts'],['entry.ts','bytes.ts']]){
    const graph=moduleGraph({sourceRoot:f.source});
    try{
      const result=graph.describe(entries);
      assert.ok(result.moduleFiles.includes('shared.ts'));
      assert.ok(result.moduleFiles.includes('dependency.ts'));
    }finally{graph.close();}
  }
  f.write('directory.ts',"import {fileInput} from './tooling/gate/reader-inputs/main.ts';fileInput(new URL('./data/',import.meta.url));");
  mkdirSync(join(f.source,'data'));
  assert.throws(()=>moduleClosure(['directory.ts'],{sourceRoot:f.source}),/declared file input is not a file: data/);
});

test('a data-directory member is entered when a real import reaches it later',t=>{
  const f=dataFixture(t);
  f.write('data/case.ts',"import './dependency.ts';");f.write('data/dependency.ts','export const answer=1;');
  f.write('importer.ts',"import './data/case.ts';");
  for(const entries of [['entry.ts','importer.ts'],['importer.ts','entry.ts']]){
    const graph=moduleGraph({sourceRoot:f.source});
    try{
      const data=graph.describe(['entry.ts']);
      assert.ok(data.files.includes('data/case.ts'));
      assert.ok(!data.ownedFiles.includes('data/case.ts'));
      const imported=graph.describe(entries);
      for(const name of ['data/case.ts','data/dependency.ts']){
        assert.ok(imported.ownedFiles.includes(name));assert.ok(imported.moduleFiles.includes(name));
      }
    }finally{graph.close();}
  }
});

test('a fixture data namespace stages its reader without reading the replaced production bytes',t=>{
  const f=dataFixture(t);f.privateData();rmSync(join(f.source,'data/case.ts'));
  const files=copyModuleClosure(['entry.ts'],f.destination,{sourceRoot:f.source,dataNamespaces:{data:'synthetic cases'}});
  assert.deepEqual(files,['entry.ts','tooling/gate/reader-inputs/main.ts']);
  assert.equal(existsSync(join(f.destination,'data/nested/second.txt')),false);
  const manifest=JSON.parse(readFileSync(join(f.destination,FIXTURE_INPUT_MANIFEST),'utf8')) as unknown;
  assert.deepEqual(manifest,{version:1,data:[{directory:'data',fixtureOwner:'synthetic cases',readers:['entry.ts']}]});
  const result=spawnTest(process.execPath,[join(f.destination,'entry.ts')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'fixture data\n');
});

test('namespace grants name an existing declared data directory and a fixture owner',t=>{
  const f=dataFixture(t);f.privateData();
  const grants:Record<string,string>[]=[{unknown:'owner'},{'../data':'owner'},{data:''}];
  for(const grant of grants){
    assert.throws(()=>copyModuleClosure(['entry.ts'],f.destination,{sourceRoot:f.source,dataNamespaces:grant}),/not a declared data input|no fixture owner/);
    assert.equal(existsSync(join(f.destination,'entry.ts')),false);
  }
  f.write('plain.ts',"const modules=new URL('./data/',import.meta.url);");
  assert.throws(()=>copyModuleClosure(['plain.ts'],f.destination,{sourceRoot:f.source,dataNamespaces:{data:'owner'}}),/not-a-host-input|not a declared data input/);
  assert.equal(existsSync(join(f.destination,'plain.ts')),false);
});

test('private extra data needs a grant and a grant never silently accepts a missing directory',t=>{
  const f=dataFixture(t);f.privateData();writeFileSync(join(f.destination,'data/extra.txt'),'fixture only');
  assert.throws(()=>copyModuleClosure(['entry.ts'],f.destination,{sourceRoot:f.source}),/explicit namespace grant: data\/extra.txt/);
  assert.equal(existsSync(join(f.destination,'entry.ts')),false);
  rmSync(join(f.destination,'data'),{recursive:true});
  assert.throws(()=>copyModuleClosure(['entry.ts'],f.destination,{sourceRoot:f.source,dataNamespaces:{data:'owner'}}),/not an owned directory: data/);
});

for(const edge of ['entry','import','asset']as const)test(`a ${edge} module remains production-owned inside substituted data`,t=>{
  const f=dataFixture(t);f.write('data/module.ts','export const value=23;');
  f.write('extra.ts',edge==='import'?"import './data/module.ts';":edge==='asset'?"const module=new URL('./data/module.ts',import.meta.url);":'export const value=1;');
  const entries=['entry.ts',edge==='entry'?'data/module.ts':'extra.ts'];
  f.privateData();writeFileSync(join(f.destination,'data/module.ts'),'private replacement');
  const production=readFileSync(join(f.source,'data/module.ts'));
  assert.throws(()=>copyModuleClosure(entries,f.destination,{sourceRoot:f.source,dataNamespaces:{data:'owner'}}),/cannot replace module-owned input: data\/module.ts/);
  assert.equal(existsSync(join(f.destination,'entry.ts')),false);
  assert.deepEqual(readFileSync(join(f.source,'data/module.ts')),production);
  rmSync(join(f.destination,'data/module.ts'));
  copyModuleClosure(entries,f.destination,{sourceRoot:f.source,dataNamespaces:{data:'owner'}});
  assert.deepEqual(readFileSync(join(f.destination,'data/module.ts')),production);
});

test('a manifest merges declaring readers but refuses a changed owner or future version',t=>{
  const f=dataFixture(t);f.privateData();f.write('second.ts',"import {dataDirectory} from './tooling/gate/reader-inputs/main.ts';const data=dataDirectory(new URL('./data/',import.meta.url));");
  const options={sourceRoot:f.source,dataNamespaces:{data:'owner'}};
  copyModuleClosure(['entry.ts'],f.destination,options);
  assert.throws(()=>copyModuleClosure(['second.ts'],f.destination,{sourceRoot:f.source}),/repeat its explicit grant: data/);
  assert.equal(readFileSync(join(f.destination,'data/case.ts'),'utf8'),'fixture data','an omitted grant cannot overwrite an earlier fixture namespace');
  assert.equal(existsSync(join(f.destination,'second.ts')),false);
  copyModuleClosure(['second.ts'],f.destination,options);
  const file=join(f.destination,FIXTURE_INPUT_MANIFEST);
  assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),{version:1,data:[{directory:'data',fixtureOwner:'owner',readers:['entry.ts','second.ts']}]});
  assert.throws(()=>copyModuleClosure(['entry.ts'],f.destination,{...options,dataNamespaces:{data:'different owner'}}),/already has another owner/);
  const future='{"version":2,"new-format":true}\n';writeFileSync(file,future);
  assert.throws(()=>copyModuleClosure(['entry.ts'],f.destination,options),/version 2|newer/);
  assert.equal(readFileSync(file,'utf8'),future);
});

test('repeated linked staging retains production module identity inside private data',t=>{
  const f=dataFixture(t);f.privateData();f.write('data/module.ts','export const value=23;');
  const options={sourceRoot:f.source,link:true,dataNamespaces:{data:'owner'}};
  for(let pass=0;pass<2;pass++)copyModuleClosure(['entry.ts','data/module.ts'],f.destination,options);
  assert.equal(lstatSync(join(f.destination,'data/module.ts')).isSymbolicLink(),true);
  assert.equal(readFileSync(join(f.destination,'data/case.ts'),'utf8'),'fixture data');
});

test('unsubstituted data links are reusable only with the explicit source-link options',t=>{
  for(const second of [{link:true},{reuseSourceLinks:true}]){
    const f=dataFixture(t),before=readFileSync(join(f.source,'data/case.ts'));
    copyModuleClosure(['entry.ts'],f.destination,{sourceRoot:f.source,link:true});
    const files=copyModuleClosure(['entry.ts'],f.destination,{sourceRoot:f.source,...second});
    assert.equal(lstatSync(join(f.destination,'data/case.ts')).isSymbolicLink(),true);
    assert.deepEqual(readFileSync(join(f.destination,'data/case.ts')),before);
    assert.equal(files.includes('data/nested/second.txt'),true);
    assert.equal(existsSync(join(f.destination,FIXTURE_INPUT_MANIFEST)),false,'production links are not private data substitutions');
    assert.throws(()=>copyModuleClosure(['entry.ts'],f.destination,{sourceRoot:f.source}),/unowned path/);
    assert.deepEqual(readFileSync(join(f.source,'data/case.ts')),before);
  }
});

test('an exact production data-directory link is read-only and retains complete membership',t=>{
  const f=dataFixture(t),before=readFileSync(join(f.source,'data/case.ts'));
  mkdirSync(f.destination);symlinkSync(join(f.source,'data'),join(f.destination,'data'),'dir');
  const options={sourceRoot:f.source,reuseSourceLinks:true};
  for(let pass=0;pass<2;pass++)assert.deepEqual(copyModuleClosure(['entry.ts'],f.destination,options),['data/case.ts','data/nested/second.txt','entry.ts','tooling/gate/reader-inputs/main.ts']);
  assert.equal(lstatSync(join(f.destination,'data')).isSymbolicLink(),true);
  assert.deepEqual(readFileSync(join(f.source,'data/case.ts')),before);
  assert.throws(()=>copyModuleClosure(['entry.ts'],f.destination,{...options,dataNamespaces:{data:'private cases'}}),/not an owned directory/);
});

test('source-link reuse rejects wrong data links and cannot bless private namespace links',t=>{
  for(const shape of ['directory','file','private-file','private-child']as const){
    const f=dataFixture(t),before=readFileSync(join(f.source,'data/case.ts')),foreign=join(dirname(f.destination),'foreign');
    mkdirSync(foreign);writeFileSync(join(foreign,'case.ts'),'wrong source');mkdirSync(f.destination);
    if(shape==='private-child')f.write('entry.ts',readFileSync(join(f.source,'entry.ts'),'utf8')+"\ndataDirectory(new URL('./data/nested/',import.meta.url));\n");
    if(shape==='directory'||shape==='private-child')symlinkSync(shape==='private-child'?join(f.source,'data'):foreign,join(f.destination,'data'),'dir');
    else{mkdirSync(join(f.destination,'data'));symlinkSync(shape==='private-file'?join(f.source,'data/case.ts'):join(foreign,'case.ts'),join(f.destination,'data/case.ts'));}
    const dataNamespaces:Record<string,string>|undefined=shape==='private-child'?{'data/nested':'private child'}:shape==='private-file'?{data:'private cases'}:undefined;
    const options={sourceRoot:f.source,link:true,reuseSourceLinks:true,...(dataNamespaces?{dataNamespaces}:{})};
    assert.throws(()=>copyModuleClosure(['entry.ts'],f.destination,options),/unowned parent|unowned path/);
    assert.equal(existsSync(join(f.destination,'entry.ts')),false);
    assert.deepEqual(readFileSync(join(f.source,'data/case.ts')),before);
    assert.equal(readFileSync(join(foreign,'case.ts'),'utf8'),'wrong source');
  }
});

test('a missing declared child under a source link fails before staging or writing through it',t=>{
  const f=dataFixture(t),before=readFileSync(join(f.source,'data/case.ts'));
  mkdirSync(f.destination);symlinkSync(join(f.source,'data'),join(f.destination,'data'),'dir');
  rmSync(join(f.source,'data/nested/second.txt'));
  assert.throws(()=>copyModuleClosure(['entry.ts'],f.destination,{sourceRoot:f.source,reuseSourceLinks:true}),/ENOENT/);
  assert.equal(existsSync(join(f.destination,'entry.ts')),false);
  assert.equal(existsSync(join(f.source,'data/nested/second.txt')),false);
  assert.deepEqual(readFileSync(join(f.source,'data/case.ts')),before);
});

test('a source-directory link never admits undeclared source members',t=>{
  const f=dataFixture(t);mkdirSync(f.destination);symlinkSync(join(f.source,'data'),join(f.destination,'data'),'dir');
  writeFileSync(join(f.source,'data/untracked.txt'),'not a declared input');
  assert.throws(()=>copyModuleClosure(['entry.ts'],f.destination,{sourceRoot:f.source,reuseSourceLinks:true}),/explicit namespace grant: data\/untracked.txt/);
  assert.equal(existsSync(join(f.destination,'entry.ts')),false);
  assert.equal(readFileSync(join(f.source,'data/untracked.txt'),'utf8'),'not a declared input');
});

test('exact source file and directory links cannot declare untracked input membership',t=>{
  for(const mode of [{link:true},{reuseSourceLinks:true}])for(const shape of ['file','directory']as const){
    const f=dataFixture(t),name=shape==='file'?'data/extra.txt':'data/extra';
    if(shape==='directory')mkdirSync(join(f.source,name));
    else writeFileSync(join(f.source,name),'untracked source bytes');
    f.privateData();rmSync(join(f.destination,'data/case.ts'));
    symlinkSync(join(f.source,name),join(f.destination,name),shape==='directory'?'dir':'file');
    assert.throws(()=>copyModuleClosure(['entry.ts'],f.destination,{sourceRoot:f.source,...mode}),/explicit namespace grant|unowned path/);
    assert.equal(existsSync(join(f.destination,'entry.ts')),false,'membership is checked before any module is copied');
    if(shape==='file')assert.equal(readFileSync(join(f.source,name),'utf8'),'untracked source bytes');
  }
});

test('nested data declarations share one granted namespace and reject ambiguous grants',t=>{
  for(const directory of ['data','data/nested']){
    const f=dataFixture(t);f.privateData();
    f.write('nested-reader.ts',"import {dataDirectory} from './tooling/gate/reader-inputs/main.ts';const data=dataDirectory(new URL('./data/nested/',import.meta.url));");
    mkdirSync(join(f.destination,'data/nested'));writeFileSync(join(f.destination,'data/nested/private.txt'),'synthetic nested data');
    assert.throws(()=>copyModuleClosure(['entry.ts','nested-reader.ts'],f.destination,{sourceRoot:f.source,dataNamespaces:{data:'parent','data/nested':'child'}}),/overlapping fixture data namespaces/);
    assert.equal(existsSync(join(f.destination,'entry.ts')),false);
    if(directory==='data/nested')rmSync(join(f.destination,'data/case.ts'));
    copyModuleClosure(['entry.ts','nested-reader.ts'],f.destination,{sourceRoot:f.source,dataNamespaces:{[directory]:'owner'}});
    assert.equal(readFileSync(join(f.destination,'data/nested/private.txt'),'utf8'),'synthetic nested data');
    if(directory==='data/nested')assert.deepEqual(readFileSync(join(f.destination,'data/case.ts')),readFileSync(join(f.source,'data/case.ts')));
    const manifest=JSON.parse(readFileSync(join(f.destination,FIXTURE_INPUT_MANIFEST),'utf8'));
    assert.deepEqual(manifest,{version:1,data:[{directory,fixtureOwner:'owner',readers:['entry.ts','nested-reader.ts']}]});
    const other=directory==='data'?'data/nested':'data';
    assert.throws(()=>copyModuleClosure(['entry.ts','nested-reader.ts'],f.destination,{sourceRoot:f.source,dataNamespaces:{[other]:'owner'}}),/overlapping fixture data namespaces|repeat its explicit grant/);
  }
});

test('fixture namespaces refuse symlinked directories, parents, members and manifests',t=>{
  for(const shape of ['directory','parent','member','manifest']as const){
    const f=dataFixture(t),foreign=join(dirname(f.destination),'foreign');mkdirSync(foreign);mkdirSync(f.destination);
    if(shape==='directory')symlinkSync(foreign,join(f.destination,'data'),'dir');
    else if(shape==='parent'){
      f.write('entry.ts',"import {dataDirectory} from './tooling/gate/reader-inputs/main.ts';const data=dataDirectory(new URL('./parent/data/',import.meta.url));");
      f.write('parent/data/case.txt','production');const added=spawnTest('git',gitArguments(['add','.']),{cwd:f.source,encoding:'utf8'});assert.equal(added.status,0,added.stderr);
      mkdirSync(join(foreign,'data'));symlinkSync(foreign,join(f.destination,'parent'),'dir');
    }else {f.privateData();if(shape==='member')symlinkSync(join(f.source,'data/case.ts'),join(f.destination,'data/link.ts'));
      else {writeFileSync(join(foreign,'manifest.json'),'{"version":1,"data":[]}');symlinkSync(join(foreign,'manifest.json'),join(f.destination,FIXTURE_INPUT_MANIFEST));}}
    const dataNamespaces:Record<string,string>=shape==='parent'?{'parent/data':'owner'}:{data:'owner'};
    assert.throws(()=>copyModuleClosure(['entry.ts'],f.destination,{sourceRoot:f.source,dataNamespaces}),/not an owned directory|unowned parent|unowned path|manifest is not an owned file/);
    assert.equal(existsSync(join(f.destination,'entry.ts')),false);
  }
});

test('a non-JavaScript reader adapter supplies the same data declarations',t=>{
  const f=dataFixture(t);f.privateData();f.write('harness.json','{}');
  const declarations=new Map([['harness.json',{imports:[],assets:[{path:'./data/',kind:'data' as const}]}]]);
  const graph=moduleGraph({sourceRoot:f.source,declarations});
  try{const result=graph.describe(['harness.json']);assert.deepEqual(result.ownedFiles,['harness.json']);assert.equal(result.directories[0]?.kind,'data');}finally{graph.close();}
  copyModuleClosure(['harness.json'],f.destination,{sourceRoot:f.source,declarations,dataNamespaces:{data:'foreign harness cases'}});
  assert.deepEqual(JSON.parse(readFileSync(join(f.destination,FIXTURE_INPUT_MANIFEST),'utf8')),{version:1,data:[{directory:'data',fixtureOwner:'foreign harness cases',readers:['harness.json']}]});
});

test('a namespace mirror reuses exact source links and copies declared assets outside it',t=>{
  const f=fixture(t);
  f.write('tooling/entry.ts',"export const input=new URL('../results/input.json',import.meta.url);");
  f.write('results/input.json','{"owned":true}\n');
  mkdirSync(f.destination);symlinkSync(join(f.source,'tooling'),join(f.destination,'tooling'),'dir');
  const before=readFileSync(join(f.source,'tooling/entry.ts'));
  assert.throws(()=>copyModuleClosure(['tooling/entry.ts'],f.destination,{sourceRoot:f.source}),/parent is not a directory/);
  assert.deepEqual(copyModuleClosure(['tooling/entry.ts'],f.destination,{sourceRoot:f.source,reuseSourceLinks:true}),['results/input.json','tooling/entry.ts']);
  assert.equal(lstatSync(join(f.destination,'results/input.json')).isSymbolicLink(),false);
  assert.deepEqual(readFileSync(join(f.destination,'results/input.json')),readFileSync(join(f.source,'results/input.json')));
  assert.deepEqual(readFileSync(join(f.source,'tooling/entry.ts')),before,'the linked source was never written');
});

test('namespace reuse never writes a missing input through a linked parent',t=>{
  const f=fixture(t),foreign=join(dirname(f.destination),'foreign');
  f.write('entry.ts',"export const input=new URL('./results/input.json',import.meta.url);");
  f.write('results/input.json','{}');
  mkdirSync(f.destination);mkdirSync(foreign);symlinkSync(foreign,join(f.destination,'results'),'dir');
  assert.throws(()=>copyModuleClosure(['entry.ts'],f.destination,{sourceRoot:f.source,reuseSourceLinks:true}),/parent is not a directory/);
  assert.equal(existsSync(join(foreign,'input.json')),false);
});

test("the public parser follows transitive imports, re-exports, type imports and cycles", t => {
  const f = fixture(t);
  f.write("entry.ts", `import './side.ts'; import type {T} from './types.ts'; export * from './middle.ts';
// import './comment.ts';
const data = "import './data.ts'"; void data;
`);
  f.write("side.ts", "export const side = 1;");
  f.write("types.ts", "export type T = number;");
  f.write("middle.ts", "export {leaf} from './nested/leaf.ts'; export type {T} from './types.ts';");
  f.write("nested/leaf.ts", "import '../entry.ts'; export const leaf = 2;");
  const expected = ["entry.ts", "middle.ts", "nested/leaf.ts", "side.ts", "types.ts"];
  assert.deepEqual(moduleClosure(["entry.ts", "side.ts"], {sourceRoot: f.source}), expected);
  assert.deepEqual(moduleClosure(["side.ts", "entry.ts"], {sourceRoot: f.source}), expected);
  assert.deepEqual(copyModuleClosure(["entry.ts"], f.destination, {sourceRoot: f.source}), expected);
  for (const file of expected) assert.deepEqual(readFileSync(join(f.destination, file)), readFileSync(join(f.source, file)));
  assert.equal(existsSync(join(f.destination, "data.ts")), false);
});

for (const link of [false, true]) test(`the complete ${link ? "linked" : "copied"} graph executes`, t => {
  const f = fixture(t);
  f.write("entry.mjs", "import {value} from './middle.mjs'; console.log(value);");
  f.write("middle.mjs", "export {value} from './nested/leaf.mjs';");
  f.write("nested/leaf.mjs", "export const value = 19;");
  const files = copyModuleClosure(["entry.mjs"], f.destination, {sourceRoot: f.source, link});
  assert.deepEqual(files, ["entry.mjs", "middle.mjs", "nested/leaf.mjs"]);
  assert.ok(files.every(file => lstatSync(join(f.destination, file)).isSymbolicLink() === link));
  const actual = spawnTest(process.execPath, [join(f.destination, "entry.mjs")], {encoding: "utf8"});
  assert.equal(actual.status, 0, actual.stderr); assert.equal(actual.stdout, "19\n"); assert.equal(actual.stderr, "");
});

test("new source imports are observed without a persistent closure cache", t => {
  const f = fixture(t); f.write("entry.ts", "export const value = 1;");
  assert.deepEqual(moduleClosure(["entry.ts"], {sourceRoot: f.source}), ["entry.ts"]);
  f.write("entry.ts", "export {value} from './new.ts';"); f.write("new.ts", "export const value = 2;");
  assert.deepEqual(moduleClosure(["entry.ts"], {sourceRoot: f.source}), ["entry.ts", "new.ts"]);
});

test("literal relative dynamic imports declare inputs while computed imports remain undeclared", t => {
  const f = fixture(t);
  f.write("entry.ts", [
    "export async function literal() {return import('./lazy.ts');}",
    "export async function template(name: string) {return import(`./${name}.ts`);}",
    "export async function variable(name: string) {return import(name);}",
    "const data = \"import('./absent.ts')\"; void data;",
  ].join("\n"));
  f.write("lazy.ts", "export {value} from './dependency.ts';");
  f.write("dependency.ts", "export const value = 23;");
  assert.deepEqual(moduleClosure(["entry.ts"], {sourceRoot: f.source}), ["dependency.ts", "entry.ts", "lazy.ts"]);
  assert.deepEqual(copyModuleClosure(["entry.ts"], f.destination, {sourceRoot: f.source}), ["dependency.ts", "entry.ts", "lazy.ts"]);
});

test("owning-project staging preserves inherited configs and follows newly declared roots", t => {
  const f = fixture(t);
  f.write("base.json", '{"compilerOptions":{"target":"ES2024","module":"nodenext","allowImportingTsExtensions":true,"noEmit":true}}');
  f.write("project/tsconfig.json", '{"extends":"../base.json","files":["src/entry.ts"]}');
  f.write("project/src/entry.ts", "export const value: number = 19; console.log(value);");
  const first = copyModuleClosure([projectInput(pathToFileURL(join(f.source,"project/src/entry.ts")))], f.destination, {sourceRoot: f.source});
  assert.deepEqual(first, ["base.json", "project/src/entry.ts", "project/tsconfig.json"]);
  for (const file of first) assert.deepEqual(readFileSync(join(f.destination, file)), readFileSync(join(f.source, file)));
  f.write("project/tsconfig.json", '{"extends":"../base.json","files":["src/entry.ts","src/registered.ts"]}');
  f.write("project/src/registered.ts", "import {value} from './dependency.ts'; console.log(value);");
  f.write("project/src/dependency.ts", "export const value: number = 23;");
  const destination = join(f.destination, "new-root");
  const second = copyModuleClosure([projectInput(pathToFileURL(join(f.source,"project/src/entry.ts")))], destination, {sourceRoot: f.source});
  assert.deepEqual(second, ["base.json", "project/src/dependency.ts", "project/src/entry.ts", "project/src/registered.ts", "project/tsconfig.json"]);
  assert.equal(readFileSync(join(destination, "project/tsconfig.json"), "utf8"), readFileSync(join(f.source, "project/tsconfig.json"), "utf8"));
  const result = spawnTest(process.execPath, [join(destination, "project/src/registered.ts")], {encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, "23\n");
});

test('project declarations promote ordinary, byte and data reach in both orders',t=>{
  const f=dataFixture(t);
  f.write('tooling/gate/reader-inputs/main.ts',"export const fileInput=url=>url;export const dataDirectory=url=>url;export const projectInput=url=>({kind:'project',url});");
  f.write('data/tsconfig.json','{"files":["case.ts","registered.ts"]}');
  f.write('data/case.ts','export const answer=19;');
  f.write('data/registered.ts',"import './dependency.ts';");f.write('data/dependency.ts','export const answer=23;');
  f.write('bytes.ts',"import {fileInput} from './tooling/gate/reader-inputs/main.ts';fileInput(new URL('./data/case.ts',import.meta.url));");
  f.write('compiled.ts',"import {projectInput} from './tooling/gate/reader-inputs/main.ts';projectInput(new URL('./data/case.ts',import.meta.url));");
  const compiled=projectInput(pathToFileURL(join(f.source,'data/case.ts')));
  for(const first of ['data/case.ts','bytes.ts','entry.ts'])for(const entries of [[first,compiled],[compiled,first]]){
    const graph=moduleGraph({sourceRoot:f.source});
    try{
      const result=graph.describe(entries);
      for(const file of ['data/case.ts','data/registered.ts','data/dependency.ts'])assert.ok(result.moduleFiles.includes(file),file);
      assert.ok(result.ownedFiles.includes('data/tsconfig.json'));
      assert.ok(!result.moduleFiles.includes('data/tsconfig.json'),'config bytes never become module entries');
    }finally{graph.close();}
  }
  const graph=moduleGraph({sourceRoot:f.source});
  try{
    const parsed=graph.describe(['compiled.ts']);
    assert.ok(parsed.files.includes('data/tsconfig.json'));
    assert.ok(parsed.moduleFiles.includes('data/registered.ts'));
    const copied=copyModuleClosure(['compiled.ts'],f.destination,{sourceRoot:f.source});
    assert.deepEqual(copied,parsed.files,'selector and staging use the same project snapshot');
  }finally{graph.close();}
});

test('project references retain their own config bytes and declared roots',t=>{
  const f=fixture(t);
  f.write('project/tsconfig.json','{"files":["entry.ts"],"references":[{"path":"../referenced"}]}');
  f.write('project/entry.ts','export const answer=19;');
  f.write('referenced/tsconfig.json','{"files":["root.ts"]}');
  f.write('referenced/root.ts','export const answer=23;');
  const graph=moduleGraph({sourceRoot:f.source});
  try{
    const result=graph.describe([projectInput(pathToFileURL(join(f.source,'project/entry.ts')))]);
    for(const file of ['project/tsconfig.json','referenced/tsconfig.json'])assert.ok(result.ownedFiles.includes(file)&&!result.moduleFiles.includes(file));
    assert.ok(result.moduleFiles.includes('referenced/root.ts'));
  }finally{graph.close();}
});

test("owning-project staging refuses missing and escaping projects before copying", t => {
  const f = fixture(t); f.write("entry.ts", "export const value = 19;");
  assert.deepEqual(moduleClosure(['entry.ts'],{sourceRoot:f.source}),['entry.ts'],'ordinary module discovery never asks for a project');
  assert.throws(() => copyModuleClosure([projectInput(pathToFileURL(join(f.source,"entry.ts")))], f.destination, {sourceRoot: f.source}), /no owning project|escapes source root/);
  assert.equal(existsSync(f.destination), false);
  f.write("tsconfig.json", '{"extends":"../outside.json","files":["entry.ts"]}');
  writeFileSync(join(f.source, "../outside.json"), '{"compilerOptions":{"noEmit":true}}');
  assert.throws(() => copyModuleClosure([projectInput(pathToFileURL(join(f.source,"entry.ts")))], f.destination, {sourceRoot: f.source}), /escapes source root/);
  assert.equal(existsSync(f.destination), false);
});

test("parsed module-relative URL assets include modules and leaves, while lookalikes and anchors declare nothing", t => {
  const f = fixture(t);
  f.write("entry.ts", `
const leaf = new URL('./data.json', import.meta.url);
const worker = new URL('./worker.ts', import.meta.url);
const anchors = [new URL('.', import.meta.url), new URL('../', import.meta.url), new URL('../..', import.meta.url)];
const data = "new URL('./absent.ts', import.meta.url)";
const other = new OtherURL('./absent.ts', import.meta.url);
const call = URL('./absent.ts', import.meta.url);
const base = new URL('./absent.ts', somewhereElse);
const dynamic = new URL(name, import.meta.url);
// new URL('./absent.ts', import.meta.url);
`);
  f.write("data.json", '"import \'./absent.ts\';"');
  f.write("worker.ts", "export {value} from './shared.ts';");
  f.write("shared.ts", "export const value = 1;");
  assert.deepEqual(moduleClosure(["entry.ts"], {sourceRoot: f.source}), ["data.json", "entry.ts", "shared.ts", "worker.ts"]);
  assert.deepEqual(copyModuleClosure(["entry.ts"], f.destination, {sourceRoot: f.source}), ["data.json", "entry.ts", "shared.ts", "worker.ts"]);
  assert.equal(readFileSync(join(f.destination, "data.json"), "utf8"), '"import \'./absent.ts\';"');
});

test("a named URL directory declares its tracked files with either spelling and reports its breadth", t => {
  const f = fixture(t);
  f.write("entry.ts", "const first = new URL('./assets', import.meta.url); const second = new URL('./assets/', import.meta.url);");
  f.write("assets/data.txt", "fixture asset");
  f.write("assets/worker.ts", "import '../shared.ts';");
  f.write("shared.ts", "export const value = 1;");
  for (const args of [["init", "--quiet", "--initial-branch=main"], ["add", "entry.ts", "assets", "shared.ts"]]) {
    const result = spawnTest("git", gitArguments(args), {cwd: f.source, encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr);
  }
  f.write("assets/untracked.txt", "not a source-tree input");
  const directories: import("./module-closure.ts").DirectoryDeclaration[] = [];
  assert.deepEqual(moduleClosure(["entry.ts"], {sourceRoot: f.source, directory: row => directories.push(row)}), ["assets/data.txt", "assets/worker.ts", "entry.ts", "shared.ts"]);
  assert.ok(directories.length > 0);
  for (const row of directories) assert.deepEqual(row, {reader: "entry.ts", directory: "assets", files: ["assets/data.txt", "assets/worker.ts"],kind:'module'});
});

test("missing imports and escaping edges fail before partial publication", t => {
  const f = fixture(t); f.write("entry.ts", "import './missing.ts';");
  assert.throws(() => copyModuleClosure(["entry.ts"], f.destination, {sourceRoot: f.source}), /missing\.ts/);
  assert.equal(existsSync(f.destination), false);
  f.write("entry.ts", "import '../outside.ts';");
  assert.throws(() => moduleClosure(["entry.ts"], {sourceRoot: f.source}), /escapes source root/);
});

test("materialisation preserves a different private fixture module", t => {
  const f = fixture(t); f.write("entry.ts", "export const value = 1;");
  copyModuleClosure(["entry.ts"], f.destination, {sourceRoot: f.source});
  writeFileSync(join(f.destination, "entry.ts"), "private mutation\n");
  assert.throws(() => copyModuleClosure(["entry.ts"], f.destination, {sourceRoot: f.source}), /different input/);
  assert.equal(readFileSync(join(f.destination, "entry.ts"), "utf8"), "private mutation\n");
});

for (const link of [false, true]) test(`a ${link ? "linked" : "copied"} fixture resolves its destination before creating directories`, t => {
  const f = fixture(t); f.write("entry.ts", "export const value = 19;");
  const control = join(f.destination, "fixture");
  assert.deepEqual(copyModuleClosure(["entry.ts"], control, {sourceRoot: f.source, link}), ["entry.ts"]);
  assert.equal(readFileSync(join(control, "entry.ts"), "utf8"), "export const value = 19;");
  assert.equal(lstatSync(join(control, "entry.ts")).isSymbolicLink(), link);
  const alias = join(dirname(f.destination), "alias"); symlinkSync(f.source, alias);
  const destination = join(alias, "fixture");
  let problem: unknown;
  try {copyModuleClosure(["entry.ts"], destination, {sourceRoot: f.source, link});} catch (error) {problem = error;}
  t.diagnostic(JSON.stringify({control: "copied normally", link, destination, refused: problem instanceof Error, sourceFixtureCreated: existsSync(join(f.source, "fixture"))}));
  assert.match(problem instanceof Error ? problem.message : "did not refuse", /fixture destination resolves inside source tree/);
  assert.equal(existsSync(join(f.source, "fixture")), false, "refuse before any mkdir or source write");
});


function contextualFixture(t:TestContext){
  const f=dataFixture(t);
  f.write('tooling/gate/reader-inputs/main.ts',"export const dataDirectory=url=>url;export const fixtureInput=(url,options)=>({kind:'fixture',url,...options});");
  f.write('fixture.ts',"import {fixtureInput} from './tooling/gate/reader-inputs/main.ts';fixtureInput(new URL('./entry.ts',import.meta.url),{dataNamespaces:{data:'context cases'}});");
  return f;
}

test('fixture descriptors keep AST, runtime staging and its data manifest equal',t=>{
  const f=contextualFixture(t);f.privateData();
  const entry=fixtureInput(pathToFileURL(join(f.source,'entry.ts')),{dataNamespaces:{data:'context cases'}});
  const graph=moduleGraph({sourceRoot:f.source});
  try{
    const runtime=graph.describe([entry]),parsed=graph.describe(['fixture.ts']);
    assert.deepEqual(parsed.files.filter(file=>file!=='fixture.ts'),runtime.files);
    assert.ok(!runtime.files.includes('data/case.ts'),'production corpus bytes have no private-fixture reach');
    assert.deepEqual(runtime.directories,[{reader:'entry.ts',directory:'data',files:[],kind:'data',fixture:{entry:'entry.ts',owner:'context cases'}}]);
    const copied=copyModuleClosure([entry],f.destination,{sourceRoot:f.source});
    assert.deepEqual(copied,runtime.files);
    assert.equal(readFileSync(join(f.destination,'data/case.ts'),'utf8'),'fixture data');
    assert.deepEqual(JSON.parse(readFileSync(join(f.destination,FIXTURE_INPUT_MANIFEST),'utf8')),
      {version:1,data:[{directory:'data',fixtureOwner:'context cases',readers:['entry.ts']}]});
  }finally{graph.close();}
});

test('a production import retains real data regardless of fixture entry order',t=>{
  const f=contextualFixture(t);
  f.write('production.ts',"import './entry.ts';");
  const graph=moduleGraph({sourceRoot:f.source});
  try{
    const privateOnly=graph.describe(['fixture.ts']);
    assert.ok(!privateOnly.files.includes('data/case.ts'));
    for(const entries of [['fixture.ts','production.ts'],['production.ts','fixture.ts']]){
      const snapshot=graph.describe(entries);
      assert.ok(snapshot.files.includes('data/case.ts'));
      assert.ok(snapshot.files.includes('data/nested/second.txt'));
      assert.equal(snapshot.directories.filter(row=>row.directory==='data').length,2);
    }
  }finally{graph.close();}
});

test('fixture grants cannot hide immutable files or module imports',t=>{
  const f=contextualFixture(t);
  f.write('data/case.ts','export const answer=42;');
  f.write('entry.ts',readFileSync(join(f.source,'entry.ts'),'utf8')+"\nimport './data/case.ts';\n");
  f.privateData();
  const entry=fixtureInput(pathToFileURL(join(f.source,'entry.ts')),{dataNamespaces:{data:'context cases'}});
  const snapshot=moduleClosure([entry],{sourceRoot:f.source});
  assert.ok(snapshot.includes('data/case.ts'),'module ownership overrides a private data namespace');
  assert.throws(()=>copyModuleClosure([entry],f.destination,{sourceRoot:f.source}),/cannot replace module-owned input: data\/case.ts/);
});

test('a fixture grant must be declared by that child, not by a neighbouring reader',t=>{
  const f=contextualFixture(t);
  f.write('other.ts','export const value=1;');
  f.write('unrelated.ts',"import './entry.ts';import {fixtureInput} from './tooling/gate/reader-inputs/main.ts';fixtureInput(new URL('./other.ts',import.meta.url),{dataNamespaces:{data:'wrong reader'}});");
  assert.throws(()=>moduleClosure(['unrelated.ts'],{sourceRoot:f.source}),/not a declared data input: data.*other.ts/);
  f.write('module-grant.ts',"import {fixtureInput} from './tooling/gate/reader-inputs/main.ts';fixtureInput(new URL('./entry.ts',import.meta.url),{dataNamespaces:{'tooling/gate':'not data'}});");
  assert.throws(()=>moduleClosure(['module-grant.ts'],{sourceRoot:f.source}),/not a declared data input: tooling\/gate/);
  assert.throws(()=>fixtureInput(pathToFileURL(join(f.source,'entry.ts')),{dataNamespaces:{'../data':'escape'}}),/not canonical/);
  assert.throws(()=>fixtureInput(pathToFileURL(join(f.source,'entry.ts')),{dataNamespaces:{data:''}}),/no fixture owner/);
  assert.throws(()=>fixtureInput(pathToFileURL(join(f.source,'entry.ts')),{dataNamespaces:{data:'one','data/nested':'two'}}),/overlapping/);
});

test('a nested fixture does not grant data ownership in its parent destination',t=>{
  const f=contextualFixture(t);
  const copied=copyModuleClosure(['fixture.ts'],f.destination,{sourceRoot:f.source});
  assert.ok(copied.includes('entry.ts'));
  assert.ok(!copied.includes('data/case.ts'));
  assert.equal(existsSync(join(f.destination,'data')),false);
  assert.equal(existsSync(join(f.destination,FIXTURE_INPUT_MANIFEST)),false);
});

test('no fixture grant still copies the complete declared production data',t=>{
  const f=contextualFixture(t);
  const entry=fixtureInput(pathToFileURL(join(f.source,'entry.ts')),{dataNamespaces:{}});
  const copied=copyModuleClosure([entry],f.destination,{sourceRoot:f.source});
  assert.ok(copied.includes('data/case.ts'));
  assert.equal(readFileSync(join(f.destination,'data/case.ts'),'utf8'),readFileSync(join(f.source,'data/case.ts'),'utf8'));
});
