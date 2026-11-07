import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,symlinkSync,unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { OracleFilesystem } from '../differential/oracle-filesystem.ts';
import { nodeExecutableIdentity,nodeProcessBirth,type NodeResolutionSession } from '../differential/oracle-runtime.ts';
import { removeOracleSnapshot } from '../differential/oracle-emit.ts';
import { publishTypeScriptOracleResults,openTypeScriptOracleResults,typeScriptOracleHandoff,oracleResultHash,type TypeScriptOracleResult } from './typescript-oracle-results.ts';
import { captureOracleDependencies } from './typescript-oracle-capture.ts';

const identity='a'.repeat(64);
function fixture(t:{after:(callback:()=>void)=>void}){
  const root=mkdtempSync(join(tmpdir(),'nts-oracle-reference-'));t.after(()=>removeOracleSnapshot(root));
  const input=join(root,'input');mkdirSync(input);const source=join(input,'case.ts');writeFileSync(source,'source');
  const processOwner={pid:process.pid,birth:nodeProcessBirth(process.pid)};
  const session:NodeResolutionSession={version:1,directory:root,token:'private-test',nodeVersion:process.versions.node,nodeSha256:'b'.repeat(64),
    executable:nodeExecutableIdentity(process.pid),holder:processOwner,owner:processOwner,options:{flags:[],nodeOptions:''},conditions:{esm:[],cjs:[]},helperSha256:'c'.repeat(64)};
  const fs=new OracleFilesystem();fs.readFile(source);
  const row:TypeScriptOracleResult={version:1,path:'case.ts',sourceSha256:oracleResultHash('source'),verdict:{ok:true},printed:{stdout:'19\n',stderr:''},observations:fs.captured()};
  return {root,input,source,fs,session,row};
}

test('three backends read one authenticated reference and replay inputs on every use',t=>{
  const f=fixture(t),directory=join(f.root,'results');
  publishTypeScriptOracleResults(directory,identity,f.session,[f.row]);
  const handoff=typeScriptOracleHandoff(directory);
  for(const backend of ['c','llvm','jvm'])assert.deepEqual(openTypeScriptOracleResults(handoff,identity).get(f.row.path,f.row.sourceSha256),{verdict:{ok:true},printed:{stdout:'19\n',stderr:''}},backend);
  const reader=openTypeScriptOracleResults(handoff,identity);reader.get(f.row.path,f.row.sourceSha256);
  writeFileSync(f.source,'changed');
  assert.throws(()=>reader.get(f.row.path,f.row.sourceSha256),/filesystem file changed/);
});

for(const mutation of ['file','link','listing'] as const)test('shared reference replays captured package '+mutation,t=>{
  const f=fixture(t),tree=join(f.root,'tree');mkdirSync(tree);
  writeFileSync(join(tree,'package.json'),'{}');symlinkSync('package.json',join(tree,'alias'));
  const semantic=JSON.stringify({packages:[{path:'',kind:'directory'},{path:'package.json',kind:'file',sha256:oracleResultHash('{}')},{path:'alias',kind:'link',target:'package.json'}]});
  writeFileSync(join(f.root,'semantic.json'),semantic);
  f.row.dependencyObservations=captureOracleDependencies({root:tree,semanticSha256:oracleResultHash(semantic),roots:[],source:f.root,sourceRevision:'test',nodeVersion:process.versions.node});
  const directory=join(f.root,'results');publishTypeScriptOracleResults(directory,identity,f.session,[f.row]);
  const reader=openTypeScriptOracleResults(typeScriptOracleHandoff(directory),identity);reader.get(f.row.path,f.row.sourceSha256);
  if(mutation==='file')writeFileSync(join(tree,'package.json'),'changed');
  else if(mutation==='link'){unlinkSync(join(tree,'alias'));symlinkSync('other',join(tree,'alias'));}
  else writeFileSync(join(tree,'new'),'appeared');
  assert.throws(()=>reader.get(f.row.path,f.row.sourceSha256),/filesystem .* changed/);
});

for(const kind of ['failed lookup','directory listing'] as const)test('a shared oracle validates its '+kind,t=>{
  const f=fixture(t),candidate=join(f.input,'candidate.ts');
  if(kind==='failed lookup')f.fs.fileExists(candidate);else f.fs.getAccessibleEntries(f.input);
  f.row.observations=f.fs.captured();const directory=join(f.root,'results');
  publishTypeScriptOracleResults(directory,identity,f.session,[f.row]);
  const reader=openTypeScriptOracleResults(typeScriptOracleHandoff(directory),identity);
  reader.get(f.row.path,f.row.sourceSha256);writeFileSync(candidate,'appeared');
  assert.throws(()=>reader.get(f.row.path,f.row.sourceSha256),kind==='failed lookup'?/fileExists changed/:/entries changed/);
});

test('unmeasured results cannot be published and missing or changed identities never become empty answers',t=>{
  const f=fixture(t),directory=join(f.root,'results');
  assert.throws(()=>publishTypeScriptOracleResults(directory,identity,f.session,[{...f.row,verdict:{ok:false,why:'stopped'}}]),/cannot publish an unmeasured/);
  publishTypeScriptOracleResults(directory,identity,f.session,[f.row]);
  const handoff=typeScriptOracleHandoff(directory);
  assert.throws(()=>openTypeScriptOracleResults(handoff,'d'.repeat(64)),/identity/);
  const reader=openTypeScriptOracleResults(handoff,identity);
  assert.throws(()=>reader.get('missing.ts',f.row.sourceSha256),/no measured case/);
  assert.throws(()=>reader.get(f.row.path,'e'.repeat(64)),/source changed/);
});
