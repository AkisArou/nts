import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {SourceFacts,GeneratedSourceFacts,inspectSourceBatches,SOURCE_BATCH_BYTES,SOURCE_BATCH_MODULES} from './source-facts.ts';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';

const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync');

test('owned installation and Cargo populations share the factory table and retain root URLs',()=>{
  const api=new API();
  try{for(const [factory,kind]of [['installationInputs','installation-inputs'],['cargoInputs','cargo-inputs'],['dependencySourceInputs','dependency-source-inputs'],['installationStatusInputs','installation-status-inputs']]){
    const source=`import {${factory} as own} from './reader-inputs/main.ts';own(new URL('../..',import.meta.url));`;
    const lease=api.createSourceFile('tooling/gate/reader.ts',source);
    try{assert.deepEqual(new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations().assets,[{kind,path:'../..'}]);}finally{lease.dispose();}
    const wrong=`import {${factory} as own} from './foreign.ts';own(new URL('./source/',import.meta.url));`;
    const foreign=api.createSourceFile('tooling/gate/reader.ts',wrong);
    try{assert.deepEqual(new SourceFacts('tooling/gate/reader.ts',wrong,foreign.sourceFile).moduleDeclarations().assets,[{kind:'module',path:'./source/'}]);}finally{foreign.dispose();}
  }}finally{api.close();}
});

test('generated project declarations retain literal include recipes through lexical factory bindings',()=>{
  const api=new API();
  try{
    for(const include of ['directory','typescript-tree']){
      const source="import {generatedProject as generated} from './reader-inputs/main.ts';generated(new URL('./base.json',import.meta.url),'./case/',"+JSON.stringify(include)+",'compiled-program');";
      const lease=api.createSourceFile('tooling/gate/reader.ts',source);
      try{assert.deepEqual(new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations().assets,[{kind:'generated-project',role:'compiled-program',path:'./base.json',directory:'./case/',include}]);}finally{lease.dispose();}
    }
    for(const argumentsText of ["new URL('./base.json',import.meta.url),'./case/'","new URL('./base.json',import.meta.url),directory,'directory'","new URL('./base.json',import.meta.url),'./case/','unknown'","new URL('./',import.meta.url),'./case/','directory'"]){
      const source="import {generatedProject} from './reader-inputs/main.ts';generatedProject("+argumentsText+",'compiled-program');",lease=api.createSourceFile('tooling/gate/reader.ts',source);
      try{assert.throws(()=>new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations(),/generated[Pp]roject|generated project/);}finally{lease.dispose();}
    }
  }finally{api.close();}
});

test('runtime edges exclude erased clauses and retain named type side effects and mixed imports',()=>{
  const api=new API(),source="import type {A} from './types.ts';export type {B} from './more-types.ts';import {type C} from './effects.ts';export {type D} from './more-effects.ts';import './side-effect.ts';import {type E,value} from './mixed.ts';";
  const lease=api.createSourceFile('host-edges.ts',source);
  try{
    const facts=new SourceFacts('host-edges.ts',source,lease.sourceFile);
    assert.deepEqual(facts.moduleDeclarations().imports,['./effects.ts','./side-effect.ts','./mixed.ts','./more-effects.ts']);
    assert.deepEqual(facts.hostModuleImports(),['./effects.ts','./side-effect.ts','./mixed.ts','./more-effects.ts']);
    const detached=facts.hostModuleImports();detached.length=0;
    assert.deepEqual(facts.hostModuleImports(),['./effects.ts','./side-effect.ts','./mixed.ts','./more-effects.ts']);
  }finally{lease.dispose();api.close();}
});

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

test('nested parameter patterns shadow imported reader and process aliases lexically',()=>{
  const api=new API(),source=`import {fileInput as bytes} from './reader-inputs/main.ts';
import {spawnSync as launch} from 'node:child_process';
function object({nested:{bytes},...rest},[,{launch}]){
  bytes(new URL('./private.txt',import.meta.url));launch('git',['status']);consume(rest);
}
function defaulted({bytes=()=>null}={}){bytes(new URL('./default.txt',import.meta.url));}
bytes(new URL('./production.txt',import.meta.url));`;
  const lease=api.createSourceFile('tooling/gate/reader.ts',source);
  try{
    const facts=new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile);
    assert.deepEqual(facts.moduleDeclarations().assets,[{path:'./private.txt',kind:'module'},{path:'./default.txt',kind:'module'},{path:'./production.txt',kind:'file'}]);
    const launch=facts.calls.find(call=>facts.code(call).startsWith("launch('git'"))!;
    assert.equal(facts.name(launch.expression),'launch');assert.equal(facts.binding(launch.expression)?.kind,'parameter');
    const rest=facts.calls.find(call=>facts.code(call)==='consume(rest)')!;
    assert.equal(facts.binding(rest.arguments[0]!)?.kind,'parameter');
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

test('accepted revision declarations have their own lexical input kind',()=>{
  const api=new API(),source=`import {acceptedRevisionData as data} from './accepted-revision-data.ts';
import * as inputs from './accepted-revision-data.ts';
import {acceptedRevisionData as fake} from './lookalike.ts';
const alias=data;data(new URL('../../docs/records/',import.meta.url));
alias(new URL('../../docs/plan.md',import.meta.url));inputs.acceptedRevisionData(new URL('./absent/',import.meta.url));
fake(new URL('./lookalike/',import.meta.url));function shadow(data){data(new URL('./working/',import.meta.url));}`;
  const lease=api.createSourceFile('tooling/gate/reader.ts',source);
  try{assert.deepEqual(new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations().assets,
    [{path:'../../docs/records/',kind:'accepted-revision'},{path:'../../docs/plan.md',kind:'accepted-revision'},
      {path:'./absent/',kind:'accepted-revision'},{path:'./lookalike/',kind:'module'},{path:'./working/',kind:'module'}]);}
  finally{lease.dispose();api.close();}
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

test('compiled project configs keep lexical factory ownership',()=>{
  const api=new API(),source=`import {projectConfig as project} from './reader-inputs/main.ts';
import * as inputs from './reader-inputs/main.ts';
const alias=project;const {projectConfig:destructured}=inputs;
project(new URL('./direct.json',import.meta.url),'compiled-program');alias(new URL('./alias.json',import.meta.url),'compiled-program');
inputs.projectConfig(new URL('./namespace.json',import.meta.url),'compiled-program');destructured(new URL('./destructured.json',import.meta.url),'compiled-program');
function shadow(project:Function){project(new URL('./shadow.json',import.meta.url));}`;
  const lease=api.createSourceFile('tooling/gate/reader.ts',source);
  try{
    assert.deepEqual(new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations().assets,
      [...['direct','alias','namespace','destructured'].map(name=>({path:'./'+name+'.json',kind:'project-config',role:'compiled-program'})),{path:'./shadow.json',kind:'module'}]);
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
    const source="import {projectConfig,moduleMembers} from './reader-inputs/main.ts';projectConfig(new URL('./solution.json',import.meta.url),'compiled-program');moduleMembers(new URL('./population/',import.meta.url),'nts.config.ts',{data:true});";
    const lease=api.createSourceFile('tooling/gate/reader.ts',source);
    try{assert.deepEqual(new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations().assets,
      [{path:'./solution.json',kind:'project-config',role:'compiled-program'},{path:'./population/',kind:'members',member:'nts.config.ts',data:true}]);}finally{lease.dispose();}
    for(const option of ['options','{data:false}','{data:true,other:true}','{...options}','{[name]:true}']){
      const text="import {moduleMembers} from './reader-inputs/main.ts';moduleMembers(new URL('./population/',import.meta.url),'nts.config.ts',"+option+");";
      const lease=api.createSourceFile('tooling/gate/reader.ts',text);
      try{assert.throws(()=>new SourceFacts('tooling/gate/reader.ts',text,lease.sourceFile).moduleDeclarations(),/literal/);}finally{lease.dispose();}
    }
  }finally{api.close();}
});


test('project collection factories use literal lexical selections and preserve root arity refusals',()=>{
  const api=new API();
  try{
    const source="import {projectCatalogue as catalogue,projectMembers as members} from './reader-inputs/main.ts';catalogue(new URL('./projects.tsv',import.meta.url),'./cases/','compiled-program');members(new URL('./',import.meta.url),'chosen-','compiled-program');members(new URL('./projects/',import.meta.url),'','compiled-program',{optional:true});";
    const lease=api.createSourceFile('tooling/gate/reader.ts',source);
    try{assert.deepEqual(new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations().assets,
      [{kind:'project-catalogue',role:'compiled-program',path:'./projects.tsv',directory:'./cases/'},{kind:'project-members',role:'compiled-program',path:'./',prefix:'chosen-'},{kind:'project-members',role:'compiled-program',path:'./projects/',prefix:'',optional:true}]);}finally{lease.dispose();}
    for(const call of ["projectMembers(new URL('./',import.meta.url),'compiled-program')","projectMembers(new URL('./',import.meta.url),prefix,'compiled-program')","projectMembers(new URL('./',import.meta.url),'../escape','compiled-program')","projectCatalogue(new URL('./projects.tsv',import.meta.url),directory,'compiled-program')","projectMembers(new URL('./',import.meta.url),'','compiled-program',options)","projectMembers(new URL('./',import.meta.url),'','compiled-program',{optional:false})","projectMembers(new URL('./',import.meta.url),'','compiled-program',{optional:true,extra:true})"]){
      const text="import {projectCatalogue,projectMembers} from './reader-inputs/main.ts';"+call;
      const lease=api.createSourceFile('tooling/gate/reader.ts',text);
      try{assert.throws(()=>new SourceFacts('tooling/gate/reader.ts',text,lease.sourceFile).moduleDeclarations(),/literal/);}finally{lease.dispose();}
    }
  }finally{api.close();}
});


test('shallow directory candidate factories require complete literal rows even at the root',()=>{
  const api=new API();
  try{
    const parse=(call:string)=>{
      const source="import {directoryCandidates as candidates} from './reader-inputs/main.ts';"+call;
      const lease=api.createSourceFile('tooling/gate/reader.ts',source);
      try{return new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations().assets;}finally{lease.dispose();}
    };
    assert.deepEqual(parse("candidates(new URL('./',import.meta.url),[{name:'ref.cpp',kind:'path-exists'},{kind:'file-exists',name:'ref.cpp'}]);"),
      [{kind:'directory-candidates',path:'./',candidates:[{name:'ref.cpp',kind:'path-exists'},{name:'ref.cpp',kind:'file-exists'}]}]);
    assert.deepEqual(parse("candidates(new URL('./',import.meta.url),[]);"),[{kind:'directory-candidates',path:'./',candidates:[]}]);
    for(const call of ["candidates(new URL('./',import.meta.url),rows)","candidates(new URL('./',import.meta.url),[{name:'../escape',kind:'optional-file'}])","candidates(new URL('./',import.meta.url),[{name:'ref.cpp',kind:mode}])","candidates(new URL('./',import.meta.url),[{name:'ref.cpp',kind:'unknown'}])","candidates(new URL('./',import.meta.url),[{name:'ref.cpp',kind:'path-exists'}],{})"])
      assert.throws(()=>parse(call),/literal|candidate/);
  }finally{api.close();}
});

test('optional module entries retain literal lexical factory ownership and arity',()=>{
  const api=new API();
  try{
    const parse=(source:string)=>{const lease=api.createSourceFile('tooling/gate/reader.ts',source);try{return new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations().assets;}finally{lease.dispose();}};
    assert.deepEqual(parse("import {optionalModule as entry} from './reader-inputs/main.ts';entry(new URL('./driver.mjs',import.meta.url));"),[{kind:'optional-module',path:'./driver.mjs'}]);
    assert.deepEqual(parse("function entry(url:URL){return url;}entry(new URL('./driver.mjs',import.meta.url));"),[{kind:'module',path:'./driver.mjs'}]);
    for(const call of ["entry(new URL('./',import.meta.url))","entry(new URL('./driver.mjs',import.meta.url),{})"])
      assert.throws(()=>parse("import {optionalModule as entry} from './reader-inputs/main.ts';"+call),/needs/);
  }finally{api.close();}
});

test('conservative directory factories retain explicit root ownership and refuse invalid arity',()=>{
  const api=new API();
  try{
    const parse=(body:string)=>{const source="import {conservativeDirectory as broad} from './reader-inputs/main.ts';"+body,lease=api.createSourceFile('tooling/gate/reader.ts',source);try{return new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations().assets;}finally{lease.dispose();}};
    assert.deepEqual(parse("broad(new URL('./',import.meta.url));broad(new URL('./types/',import.meta.url));"),[{kind:'conservative',path:'./'},{kind:'conservative',path:'./types/'}]);
    assert.throws(()=>parse("broad(new URL('./',import.meta.url),{});"),/exactly one URL/);
  }finally{api.close();}
});

test('ordered project alternatives are literal declarations of the same reader owner',()=>{
  const api=new API();
  try{
    const source="import {projectChoice as choose} from './reader-inputs/main.ts';choose(new URL('./first.json',import.meta.url),['../fallback.json'],'compiled-program');";
    const lease=api.createSourceFile('tooling/gate/reader.ts',source);
    try{assert.deepEqual(new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations().assets,
      [{kind:'project-choice',role:'compiled-program',path:'./first.json',alternatives:['../fallback.json']}]);}finally{lease.dispose();}
    for(const values of ['choices','[...choices]','[choice]',"['file:///outside.json']"]){
      const text="import {projectChoice} from './reader-inputs/main.ts';projectChoice(new URL('./first.json',import.meta.url),"+values+",'compiled-program');";
      const lease=api.createSourceFile('tooling/gate/reader.ts',text);
      try{assert.throws(()=>new SourceFacts('tooling/gate/reader.ts',text,lease.sourceFile).moduleDeclarations(),/literal/);}finally{lease.dispose();}
    }
  }finally{api.close();}
});


test('every project factory requires its literal execution role without a default',()=>{
  const api=new API();
  try{
    for(const [factory,args]of [
      ['projectConfig',"new URL('./tsconfig.json',import.meta.url)"],
      ['projectChoice',"new URL('./tsconfig.json',import.meta.url),[]"],
      ['projectCatalogue',"new URL('./cases.tsv',import.meta.url),'./cases/'"],
      ['projectMembers',"new URL('./cases/',import.meta.url),''"],
      ['generatedProject',"new URL('./base.json',import.meta.url),'./case/','directory'"],
    ])for(const suffix of ['',',undefined',",'unowned-role'"]){
      const source=`import {${factory}} from './reader-inputs/main.ts';${factory}(${args}${suffix});`;
      const lease=api.createSourceFile('tooling/gate/reader.ts',source);
      try{assert.throws(()=>new SourceFacts('tooling/gate/reader.ts',source,lease.sourceFile).moduleDeclarations(),/role|literal|needs/);}
      finally{lease.dispose();}
    }
  }finally{api.close();}
});
