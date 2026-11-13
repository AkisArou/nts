import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {SourceFacts,GeneratedSourceFacts,inspectSourceBatches,SOURCE_BATCH_BYTES,SOURCE_BATCH_MODULES} from './source-facts.ts';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';

const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync');

test('the oracle compiles the data declaration leaf under its own one-file project',()=>{
  const entry=fileURLToPath(new URL('./reader-inputs/main.ts',import.meta.url));
  const project=new OracleFilesystem().projectFor(entry);
  assert.equal(project,fileURLToPath(new URL('./reader-inputs/tsconfig.json',import.meta.url)));
  const api=new API();
  try{
    const parsed=api.parseConfigFile(project!);assert.deepEqual(parsed.fileNames,[entry]);
    const program=api.createProgram(parsed.fileNames,parsed.options);
    try{assert.deepEqual([...parsed.errors,...program.getProgramDiagnostics(),...program.getGlobalDiagnostics(),
      ...program.getSyntacticDiagnostics(),...program.getBindDiagnostics(),...program.getSemanticDiagnostics()],[]);}
    finally{program.dispose();}
  }finally{api.close();}
});

test('one structural pass supplies lexical bindings, parents, subtree calls and detached edges',()=>{
  const api=new API(),source=`import {writeFileSync as write} from 'node:fs';
export {value} from './value.ts';const data=new URL('./input.json',import.meta.url);
function first(){const file='first';write(file,JSON.stringify({ok:true}));}
function second(){const file='second';write(file,'data');}
const pending=import('./dynamic.ts');`;
  const lease=api.createSourceFile('facts.ts',source);
  try{
    const facts=new SourceFacts('facts.ts',source,lease.sourceFile),ast=facts.ast;
    const writes=facts.calls.filter(call=>facts.name(call.expression)==='fs.writeFileSync');assert.equal(writes.length,2);
    assert.equal(facts.code(facts.resolve(writes[0]!.arguments[0]!)),"'first'");
    assert.equal(facts.code(facts.resolve(writes[1]!.arguments[0]!)),"'second'");
    const functions=facts.ofKind(ast.SyntaxKind.FunctionDeclaration);assert.equal(functions.length,2);
    assert.equal(facts.callsWithin(functions[0]!).length,2);assert.equal(facts.callsWithin(functions[1]!).length,1);
    assert.ok([...facts.ancestors(writes[0]!)].includes(functions[0]!));
    assert.deepEqual(facts.moduleDeclarations(),{imports:['./value.ts','./dynamic.ts'],assets:[{path:'./input.json',kind:'module'}]});
    assert.equal(facts.line(source.indexOf('function second')),4);
  }finally{lease.dispose();api.close();}
});

test('generated source is parsed once per parent session and shares its structural rows',()=>{
  const api=new API(),generated=new GeneratedSourceFacts(api,'parent.test.ts');
  try{
    const source='const result=await import("./result.ts");';
    const first=generated.get(source);assert.equal(generated.get(source),first);
    assert.equal(first.topLevelAwaits.length,1);
    generated.shell('printf ready > "$ready"',12);generated.shell('printf ready > "$ready"',12);
    assert.equal(generated.shells.length,1);assert.equal(generated.shells[0]!.shell.redirections.length,1);
  }finally{generated.close();api.close();}
});

test('data directories are recognized by their lexical owner, including aliases but not shadows',()=>{
  const api=new API(),source=`import {dataDirectory as data} from './reader-inputs/main.ts';
import * as inputs from './reader-inputs/main.ts';
import {dataDirectory as other} from './lookalike.ts';
const alias=data;const {dataDirectory:destructured}=inputs;
data(new URL('./direct/',import.meta.url));alias(new URL('./alias/',import.meta.url));
inputs.dataDirectory(new URL('./namespace/',import.meta.url));destructured(new URL('./destructured/',import.meta.url));
other(new URL('./lookalike/',import.meta.url));
function shadow(data:Function){data(new URL('./parameter/',import.meta.url));}
function local(){function data(url:URL){return url;}data(new URL('./function/',import.meta.url));}`;
  const lease=api.createSourceFile('tooling/gate/reader.ts',source);
  try{
    const declarations=new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations();
    assert.deepEqual(declarations.assets,[...['direct','alias','namespace','destructured'].map(name=>({path:'./'+name+'/',kind:'data'})),
      ...['lookalike','parameter','function'].map(name=>({path:'./'+name+'/',kind:'module'}))]);
  }finally{lease.dispose();api.close();}
});

test('inspection directories are recognized by their lexical owner, including aliases but not shadows',()=>{
  const api=new API(),source=`import {inspectionDirectory as data} from './reader-inputs/main.ts';
import * as inputs from './reader-inputs/main.ts';
import {inspectionDirectory as other} from './lookalike.ts';
const alias=data;const {inspectionDirectory:destructured}=inputs;
data(new URL('./direct/',import.meta.url));alias(new URL('./alias/',import.meta.url));
inputs.inspectionDirectory(new URL('./namespace/',import.meta.url));destructured(new URL('./destructured/',import.meta.url));
other(new URL('./lookalike/',import.meta.url));
function shadow(data:Function){data(new URL('./parameter/',import.meta.url));}
function local(){function data(url:URL){return url;}data(new URL('./function/',import.meta.url));}`;
  const lease=api.createSourceFile('tooling/gate/reader.ts',source);
  try{
    const declarations=new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations();
    assert.deepEqual(declarations.assets,[...['direct','alias','namespace','destructured'].map(name=>({path:'./'+name+'/',kind:'inspection'})),
      ...['lookalike','parameter','function'].map(name=>({path:'./'+name+'/',kind:'module'}))]);
  }finally{lease.dispose();api.close();}
});

test('exact byte inputs have the same lexical ownership rule as data directories',()=>{
  const api=new API(),source=`import {fileInput as bytes} from './reader-inputs/main.ts';
import * as inputs from './reader-inputs/main.ts';
import {fileInput as other} from './lookalike.ts';
const alias=bytes;const {fileInput:destructured}=inputs;
bytes(new URL('./direct.ts',import.meta.url));alias(new URL('./alias.ts',import.meta.url));
inputs.fileInput(new URL('./namespace.ts',import.meta.url));destructured(new URL('./destructured.ts',import.meta.url));
other(new URL('./lookalike.ts',import.meta.url));
function shadow(bytes:Function){bytes(new URL('./parameter.ts',import.meta.url));}`;
  const lease=api.createSourceFile('tooling/gate/reader.ts',source);
  try{
    const declarations=new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations();
    assert.deepEqual(declarations.assets,[...['direct','alias','namespace','destructured'].map(name=>({path:'./'+name+'.ts',kind:'file'})),
      ...['lookalike','parameter'].map(name=>({path:'./'+name+'.ts',kind:'module'}))]);
  }finally{lease.dispose();api.close();}
});

test('optional files and membership keep lexical ownership, with explicit root membership only',()=>{
  const api=new API(),source=`import {optionalFile as candidate,directoryMembership as names} from './reader-inputs/main.ts';
import * as input from './reader-inputs/main.ts';
import {directoryMembership as lookalike} from './lookalike.ts';
const alias=candidate;
candidate(new URL('./candidate.json',import.meta.url));alias(new URL('./alias.json',import.meta.url));
input.optionalFile(new URL('./namespace.json',import.meta.url));
names(new URL('./',import.meta.url));input.directoryMembership(new URL('../..',import.meta.url));
new URL('./',import.meta.url);lookalike(new URL('./',import.meta.url));
function shadow(names:Function){names(new URL('./',import.meta.url));}
function other(candidate:Function){candidate(new URL('./ordinary.json',import.meta.url));}`;
  const lease=api.createSourceFile('tooling/gate/reader.ts',source);
  try{
    assert.deepEqual(new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations().assets,
      [...['candidate','alias','namespace'].map(name=>({path:'./'+name+'.json',kind:'optional-file'})),
        {path:'./',kind:'membership'},{path:'../..',kind:'membership'},{path:'./ordinary.json',kind:'module'}]);
  }finally{lease.dispose();api.close();}
});

test('invalid metadata factory arguments cannot turn a root anchor into a module population',()=>{
  const api=new API();
  try{for(const [factory,path]of [['directoryMembership','./'],['optionalFile','./candidate.json']]){
    const source=`import {${factory}} from './reader-inputs/main.ts';${factory}(new URL('${path}',import.meta.url),{});`;
    const lease=api.createSourceFile('tooling/gate/reader.ts',source);
    try{assert.throws(()=>new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations(),/needs exactly one URL input/);}
    finally{lease.dispose();}
  }}finally{api.close();}
});

test('compiled project entries keep lexical factory ownership',()=>{
  const api=new API(),source=`import {projectInput as project} from './reader-inputs/main.ts';
import * as inputs from './reader-inputs/main.ts';
const alias=project;const {projectInput:destructured}=inputs;
project(new URL('./direct.ts',import.meta.url));alias(new URL('./alias.ts',import.meta.url));
inputs.projectInput(new URL('./namespace.ts',import.meta.url));destructured(new URL('./destructured.ts',import.meta.url));
function shadow(project:Function){project(new URL('./shadow.ts',import.meta.url));}`;
  const lease=api.createSourceFile('tooling/gate/reader.ts',source);
  try{
    assert.deepEqual(new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations().assets,
      [...['direct','alias','namespace','destructured'].map(name=>({path:'./'+name+'.ts',kind:'project'})),{path:'./shadow.ts',kind:'module'}]);
  }finally{lease.dispose();api.close();}
});

test('source leases are batched by both module count and bytes, with an oversized module alone',()=>{
  const api=new API(),large='/*'+'x'.repeat(SOURCE_BATCH_BYTES)+'*/';
  const inputs=[{file:'small.ts',source:'export const small=1;'}, {file:'large.ts',source:large},
    ...Array.from({length:2*SOURCE_BATCH_MODULES+1},(_,i)=>({file:'entry-'+i+'.ts',source:'export const value='+i+';'}))];
  const visited:string[]=[];
  try{
    const result=inspectSourceBatches(api,inputs,facts=>visited.push(facts.file));
    assert.deepEqual(visited,inputs.map(input=>input.file));
    assert.deepEqual(result,{modules:inputs.length,batches:5,largestBatchModules:SOURCE_BATCH_MODULES,largestBatchBytes:Buffer.byteLength(large)});
  }finally{api.close();}
});


test('fixture contexts use lexical factory bindings and literal namespace owners',()=>{
  const api=new API(),source=`import {fixtureInput as fixture} from './reader-inputs/main.ts';
import * as inputs from './reader-inputs/main.ts';
const alias=fixture;const {fixtureInput:destructured}=inputs;
fixture(new URL('./direct.ts',import.meta.url),{dataNamespaces:{'tests/programs':'direct cases'}});
alias(new URL('./alias.ts',import.meta.url),{dataNamespaces:{'tests/programs':'alias cases'}});
inputs.fixtureInput(new URL('./namespace.ts',import.meta.url),{dataNamespaces:{'tests/programs':'namespace cases'}});
destructured(new URL('./destructured.ts',import.meta.url),{dataNamespaces:{'tests/programs':'destructured cases'}});
function shadow(fixture:Function){fixture(new URL('./shadow.ts',import.meta.url),{dataNamespaces:{'tests/programs':'shadow'}});}`;
  const lease=api.createSourceFile('tooling/gate/reader.ts',source);
  try{
    assert.deepEqual(new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations().assets,
      [...['direct','alias','namespace','destructured'].map(name=>({path:'./'+name+'.ts',kind:'fixture',dataNamespaces:{'tests/programs':name+' cases'}})),{path:'./shadow.ts',kind:'module'}]);
  }finally{lease.dispose();api.close();}
});

test('computed, spread, duplicate or noncanonical fixture grants are refused',()=>{
  const api=new API();
  try{
    for(const options of ["options","{dataNamespaces:names}","{dataNamespaces:{[name]:'cases'}}","{dataNamespaces:{...names}}",
      "{dataNamespaces:{'data':'one','data':'two'}}","{dataNamespaces:{'../data':'cases'}}","{dataNamespaces:{data:''}}"]){
      const source="import {fixtureInput} from './reader-inputs/main.ts';fixtureInput(new URL('./entry.ts',import.meta.url),"+options+");";
      const lease=api.createSourceFile('tooling/gate/reader.ts',source);
      try{assert.throws(()=>new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations(),/fixture/);}
      finally{lease.dispose();}
    }
  }finally{api.close();}
});


test('module members require their lexical owner and a literal basename',()=>{
  const api=new API();
  try{
    const source="import {moduleMembers as members} from './reader-inputs/main.ts';members(new URL('./population/',import.meta.url),'nts.config.ts');function shadow(members){members(new URL('./other/',import.meta.url),'nts.config.ts');}";
    const lease=api.createSourceFile('tooling/gate/reader.ts',source);
    try{assert.deepEqual(new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations().assets,
      [{path:'./population/',kind:'members',member:'nts.config.ts'},{path:'./other/',kind:'module'}]);}finally{lease.dispose();}
    for(const member of ['name',"'**/nts.config.ts'","'../nts.config.ts'"]){
      const text="import {moduleMembers} from './reader-inputs/main.ts';moduleMembers(new URL('./population/',import.meta.url),"+member+");";
      const lease=api.createSourceFile('tooling/gate/reader.ts',text);
      try{assert.throws(()=>new SourceFacts('tooling/gate/reader.ts',text,lease.sourceFile).moduleDeclarations(),/literal/);}finally{lease.dispose();}
    }
  }finally{api.close();}
});


test('explicit config and mixed data roles are literal declarations of the same owner',()=>{
  const api=new API();
  try{
    const source="import {projectConfig,moduleMembers} from './reader-inputs/main.ts';projectConfig(new URL('./solution.json',import.meta.url));moduleMembers(new URL('./population/',import.meta.url),'nts.config.ts',{data:true});";
    const lease=api.createSourceFile('tooling/gate/reader.ts',source);
    try{assert.deepEqual(new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations().assets,
      [{path:'./solution.json',kind:'project-config'},{path:'./population/',kind:'members',member:'nts.config.ts',data:true}]);}finally{lease.dispose();}
    for(const option of ['options','{data:false}','{data:true,other:true}','{...options}','{[name]:true}']){
      const text="import {moduleMembers} from './reader-inputs/main.ts';moduleMembers(new URL('./population/',import.meta.url),'nts.config.ts',"+option+");";
      const lease=api.createSourceFile('tooling/gate/reader.ts',text);
      try{assert.throws(()=>new SourceFacts('tooling/gate/reader.ts',text,lease.sourceFile).moduleDeclarations(),/literal/);}finally{lease.dispose();}
    }
  }finally{api.close();}
});
