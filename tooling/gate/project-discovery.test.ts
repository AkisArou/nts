import assert from 'node:assert/strict';
import {mkdirSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {projectDiscoveryOwner,projectRequest,removedProjectMatches,type ProjectRequest} from './project-discovery.ts';
import {projectInputs} from './project-inputs.ts';
import {testScratch} from './test-scratch.ts';

function fixture(t:Parameters<typeof testScratch>[0]){
  const root=testScratch(t,'project-discovery');mkdirSync(join(root,'src'));
  const write=(path:string,text:string)=>writeFileSync(join(root,path),text);
  write('base.json',JSON.stringify({compilerOptions:{module:'preserve',moduleResolution:'bundler',types:[]}}));
  write('tsconfig.json',JSON.stringify({extends:'./base.json',include:['src/**/*'],exclude:['src/excluded.ts']}));
  write('src/main.ts','export const value=1;');
  return {root,write};
}

test('native matched queries ignore nonmatching outputs and notice matching additions, deletions and renames',t=>{
  const f=fixture(t),owner=projectDiscoveryOwner(f.root),request={kind:'config',path:'tsconfig.json'} as const;
  try{
    const first=owner.read(request);assert.deepEqual(first.files,['src/main.ts']);
    const program=projectInputs([request],f.root);assert.deepEqual(program.matches,[first]);
    for(const path of ['tsconfig.tsbuildinfo','src/emitted.js','src/notes.tsv','src/excluded.ts'])f.write(path,'export {};');
    assert.deepEqual(owner.read(request),first);
    f.write('src/added.ts','export {};');assert.deepEqual(owner.read(request).files,['src/added.ts','src/main.ts']);
    renameSync(join(f.root,'src/added.ts'),join(f.root,'src/renamed.ts'));
    assert.deepEqual(owner.read(request).files,['src/main.ts','src/renamed.ts']);
    rmSync(join(f.root,'src/renamed.ts'));assert.deepEqual(owner.read(request),first);
    f.write('base.json',JSON.stringify({compilerOptions:{module:'preserve',moduleResolution:'bundler',types:[],allowJs:true}}));
    assert.deepEqual(owner.read(request).files,['src/emitted.js','src/main.ts']);
    f.write('tsconfig.json',JSON.stringify({extends:'./base.json',include:['src/excluded.ts']}));
    assert.deepEqual(owner.read(request).files,['src/excluded.ts']);
  }finally{owner.close();}
  assert.throws(()=>owner.read(request),/owner is closed/);
});

test('each referenced project retains its own native matching query',t=>{
  const f=fixture(t);mkdirSync(join(f.root,'reference'));
  f.write('reference/tsconfig.json','{"compilerOptions":{"types":[]},"include":["*.ts"]}');
  f.write('reference/ref.ts','export {};');
  f.write('tsconfig.json','{"extends":"./base.json","include":["src/*.ts"],"references":[{"path":"./reference"}]}');
  const input=projectInputs([{kind:'config',path:'tsconfig.json'}],f.root),owner=projectDiscoveryOwner(f.root);
  try{
    assert.deepEqual(input.matches.map(row=>row.request.path),['tsconfig.json','reference/tsconfig.json']);
    for(const match of input.matches)assert.deepEqual(owner.read(match.request),match);
    f.write('reference/added.ts','export {};');
    assert.deepEqual(owner.read(input.matches[0]!.request),input.matches[0]);
    assert.notDeepEqual(owner.read(input.matches[1]!.request),input.matches[1]);
  }finally{owner.close();}
});

test('committed native matches retain deleted roots without selecting unrelated or excluded deletions',t=>{
  const before=fixture(t),current=fixture(t);
  before.write('src/gone.ts','interface RemovedGlobal { value: number }');
  before.write('src/excluded.ts','export {};');before.write('src/notes.tsv','ignored');
  const owner=projectDiscoveryOwner(current.root);
  try{for(const request of [{kind:'config',path:'tsconfig.json'},{kind:'generated',path:'base.json',directory:'src',include:'typescript-tree'}] as const){
    const row=owner.read(request),changes=[{path:'src/gone.ts',deleted:true},{path:'src/notes.tsv',deleted:true}];
    assert.deepEqual([...removedProjectMatches(before.root,[row],changes).values()],[['src/gone.ts']]);
    assert.deepEqual([...removedProjectMatches(before.root,[row],[{path:'src',deleted:true}]).values()],[['src']]);
    assert.equal(removedProjectMatches(before.root,[row],[{path:'src/notes.tsv',deleted:true}]).size,0,'unrelated dirty matches do not widen another question');
    if(request.kind==='config')assert.equal(removedProjectMatches(before.root,[row],[{path:'src/excluded.ts',deleted:true}]).size,0,'the compiler owns exclusions');
  }}finally{owner.close();}
});

test('generated matching reuses the literal recipe owner and removes every private config',t=>{
  const f=fixture(t),parent=join(f.root,'private');mkdirSync(parent);
  f.write('src/other.mts','export {};');mkdirSync(join(f.root,'src/nested'));f.write('src/nested/child.ts','export {};');
  const owner=projectDiscoveryOwner(f.root,parent);
  try{for(const include of ['directory','typescript-tree'] as const){
    const request:ProjectRequest={kind:'generated',path:'base.json',directory:'src',include};
    const captured=projectInputs([request],f.root),match=owner.read(request);
    assert.deepEqual(captured.matches,[match]);assert.deepEqual(readdirSync(parent),[]);
    assert.deepEqual(match.files,include==='directory'?['src/main.ts','src/other.mts','src/nested/child.ts']:['src/main.ts','src/nested/child.ts']);
    assert.ok(!JSON.stringify(match).includes('project-config-'));
  }}finally{owner.close();}
});

test('a failed parse leaves the same discovery owner usable with a fresh filesystem capture',t=>{
  const f=fixture(t),owner=projectDiscoveryOwner(f.root);
  try{
    f.write('tsconfig.json','{"extends":"./absent.json"}');
    assert.throws(()=>owner.read({kind:'config',path:'tsconfig.json'}),/config cannot be parsed/);
    f.write('absent.json','{"compilerOptions":{"types":[]},"files":["src/main.ts"]}');
    assert.deepEqual(owner.read({kind:'config',path:'tsconfig.json'}).files,['src/main.ts']);
  }finally{owner.close();}
});

test('discovery queries refuse unknown fields and escaping recipes before acquiring a parser',()=>{
  for(const value of [null,{kind:'config',path:'../outside.json'},{kind:'config',path:'tsconfig.json',files:[]},
    {kind:'generated',path:'base.json',directory:'../outside',include:'directory'},
    {kind:'generated',path:'base.json',directory:'',include:'**/*.ts'}])assert.throws(()=>projectRequest(value),/project discovery/);
  assert.deepEqual(projectRequest({kind:'generated',path:'base.json',directory:'',include:'directory'}),{kind:'generated',path:'base.json',directory:'',include:'directory'});
});
