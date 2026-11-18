import assert from 'node:assert/strict';
import {mkdirSync,readdirSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {projectDiscoveryOwner,projectRequest,removedProjectMatches,type ProjectRequest} from './project-discovery.ts';
import {projectInputs} from './project-inputs.ts';
import {testScratch} from './test-scratch.ts';
import {execFileSync} from 'node:child_process';
import {gitArguments} from './git-arguments/main.ts';
import {fixtureEnvironment} from './test-environment.ts';

function fixture(t:Parameters<typeof testScratch>[0]){
  const root=testScratch(t,'project-discovery');mkdirSync(join(root,'src'));
  const write=(path:string,text:string)=>writeFileSync(join(root,path),text);
  write('base.json',JSON.stringify({compilerOptions:{module:'preserve',moduleResolution:'bundler',types:[]}}));
  write('tsconfig.json',JSON.stringify({extends:'./base.json',include:['src/**/*'],exclude:['src/excluded.ts']}));
  write('src/main.ts','export const value=1;');
  return {root,write};
}

function committed(t:Parameters<typeof testScratch>[0],root:string){
  const env=fixtureEnvironment(t),git=(...args:string[])=>execFileSync('git',gitArguments(args),{cwd:root,env,encoding:'utf8'}).trim();
  git('init','--quiet');git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','base sources');return git('rev-parse','HEAD');
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
  const revision=committed(t,before.root);
  const owner=projectDiscoveryOwner(current.root);
  try{for(const request of [{kind:'config',path:'tsconfig.json'},{kind:'generated',path:'base.json',directory:'src',include:'typescript-tree'}] as const){
    const row=owner.read(request),changes=[{path:'src/gone.ts',deleted:true},{path:'src/notes.tsv',deleted:true}];
    assert.deepEqual([...removedProjectMatches(before.root,[row],changes,revision).values()],[['src/gone.ts']]);
    assert.deepEqual([...removedProjectMatches(before.root,[row],[{path:'src',deleted:true}],revision).values()],[['src']]);
    assert.equal(removedProjectMatches(before.root,[row],[{path:'src/notes.tsv',deleted:true}],revision).size,0,'unrelated dirty matches do not widen another question');
    if(request.kind==='config')assert.equal(removedProjectMatches(before.root,[row],[{path:'src/excluded.ts',deleted:true}],revision).size,0,'the compiler owns exclusions');
  }}finally{owner.close();}
});

test('native logical names retain their base physical deletion through a retargeted alias chain',t=>{
  const before=fixture(t),current=fixture(t),request={kind:'config',path:'tsconfig.json'} as const;
  for(const f of [before,current]){
    for(const directory of ['physical','replacement']){
      mkdirSync(join(f.root,directory));f.write(directory+'/keep.ts','export {};');
      if(directory==='replacement'||f===before)f.write(directory+'/gone.ts','interface Gone { value: number }');
    }
    symlinkSync('alias2',join(f.root,'alias'));symlinkSync(f===before?'physical':'replacement',join(f.root,'alias2'));
    f.write('tsconfig.json','{"extends":"./base.json","include":["src/main.ts","alias/**/*.ts"]}');
  }
  const revision=committed(t,before.root),old=projectDiscoveryOwner(before.root),tip=projectDiscoveryOwner(current.root);
  try{
    const row=tip.read(request);assert.deepEqual(old.read(request).files,row.files,'retargeting retains the logical match list');
    for(const changes of [[{path:'physical/gone.ts',deleted:true}],[{path:'physical/gone.ts',deleted:true},{path:'alias2',sameMode:false}]])
      assert.deepEqual([...removedProjectMatches(before.root,[row],changes,revision).values()],[['physical/gone.ts']]);
  }finally{old.close();tip.close();}
});

test('a newly added alias does not retroactively match a deleted physical source at the base',t=>{
  const before=fixture(t),current=fixture(t),request={kind:'config',path:'tsconfig.json'} as const;
  for(const f of [before,current]){
    mkdirSync(join(f.root,'physical'));f.write('physical/keep.ts','export {};');
    if(f===before)f.write('physical/gone.ts','export {};');
    f.write('tsconfig.json','{"extends":"./base.json","include":["src/main.ts","added/**/*.ts"]}');
  }
  symlinkSync('physical',join(current.root,'added'));
  const revision=committed(t,before.root),owner=projectDiscoveryOwner(current.root);
  try{
    const row=owner.read(request);assert.ok(row.files.includes('added/keep.ts'));
    assert.equal(removedProjectMatches(before.root,[row],[{path:'physical/gone.ts',deleted:true},{path:'added',added:true}],revision).size,0);
  }finally{owner.close();}
});

test('a removed native match through an outside alias refuses rather than losing its consumers',t=>{
  const before=fixture(t),current=fixture(t),outsideBefore=fixture(t),outsideTip=fixture(t);
  outsideBefore.write('src/gone.ts','export {};');
  for(const f of [before,current]){
    const outside=f===before?outsideBefore:outsideTip;
    symlinkSync(join(outside.root,'src'),join(f.root,'alias'));
    f.write('tsconfig.json','{"extends":"./base.json","include":["src/main.ts","alias/**/*.ts"]}');
  }
  const revision=committed(t,before.root),owner=projectDiscoveryOwner(current.root);
  try{assert.throws(()=>removedProjectMatches(before.root,[owner.read({kind:'config',path:'tsconfig.json'})],[{path:'alias/gone.ts',deleted:true}],revision),/committed project match leaves source/);}
  finally{owner.close();}
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
