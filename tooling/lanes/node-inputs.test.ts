import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,readlinkSync,realpathSync,renameSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {test,type TestContext} from 'node:test';
import {acquire,inventory,link,pairPath,type Records} from './node-inputs.ts';
import {fixtureInputs} from './node-inputs-test-fixture.ts';

function scratch(t:TestContext){
  const base=join(homedir(),'.cache/nts/node-inputs-tests');mkdirSync(base,{recursive:true});
  const root=mkdtempSync(join(base,'t-'));
  t.after(()=>{
    function writable(path:string){if(lstatSync(path).isDirectory()){chmodSync(path,0o755);for(const name of readdirSync(path))writable(join(path,name));}}
    writable(root);rmSync(root,{recursive:true,force:true});
  });
  const old=join(root,'old'),next=join(root,'next'),cache=join(root,'cache');
  const a=fixtureInputs(old,'24.20.0'),b=fixtureInputs(next,'26.13.0');
  const table:Records={version:1,releases:{...a.releases,...b.releases}};
  return {root,old,next,cache,table};
}
function candidate(source:string,target:string){
  mkdirSync(join(target,'build/node-deps'),{recursive:true});
  for(const file of ['.tool-versions','build/node-deps/recipes.json'])writeFileSync(join(target,file),readFileSync(join(source,file)));
}

test('Node 24 and 26 candidates select side-by-side immutable recipe-matching pairs',t=>{
  const {root,old,next,cache,table}=scratch(t);
  const original=inventory(join(old,'third_party/node')),native=inventory(join(old,'third_party/node-source'));
  const a=acquire(old,cache,table),b=acquire(next,cache,table);assert.notEqual(a,b);
  assert.deepEqual(inventory(join(a,'node')),original);assert.deepEqual(inventory(join(a,'node-source')),native);
  for(const [source,name,pair] of [[old,'gate24',a],[next,'gate26',b]] as const){
    const tree=join(root,name);candidate(source,tree);assert.equal(link(tree,cache,table),pair);
    assert.equal(realpathSync(join(tree,'third_party/node')),join(pair,'node'));
    assert.equal(realpathSync(join(tree,'third_party/node-source')),join(pair,'node-source'));
    assert.equal(lstatSync(join(pair,'node/lib/control.js')).mode&0o222,0);
  }
  assert.deepEqual(inventory(join(old,'third_party/node')),original,'the old source is untouched');
});

test('linking either Node version leaves a real candidate checkout clean',t=>{
  const {root,old,next,cache,table}=scratch(t);acquire(old,cache,table);acquire(next,cache,table);
  for(const [source,name] of [[old,'clean24'],[next,'clean26']] as const){
    const tree=join(root,name);candidate(source,tree);
    writeFileSync(join(tree,'.gitignore'),readFileSync(new URL('../../.gitignore',import.meta.url)));
    const git=(...args:string[])=>execFileSync('git',args,{cwd:tree,encoding:'utf8'}).trim();
    git('init','-q');git('add','.tool-versions','.gitignore','build/node-deps/recipes.json');
    git('-c','user.name=Node input control','-c','user.email=node-input-control@invalid','commit','-qm','candidate inputs');
    assert.equal(git('status','--porcelain'),'');link(tree,cache,table);
    assert.equal(git('status','--porcelain'),'');
    for(const role of ['node','node-source','node-inputs'])assert.equal(git('check-ignore',`third_party/${role}`),`third_party/${role}`);
  }
});

test('a missing new pair never borrows an available old pair or shared clone',t=>{
  const {root,old,next,cache,table}=scratch(t);acquire(old,cache,table);
  const tree=join(root,'gate26');candidate(next,tree);mkdirSync(join(tree,'third_party'),{recursive:true});
  symlinkSync(join(old,'third_party/node'),join(tree,'third_party/node'));
  assert.throws(()=>link(tree,cache,table),/missing immutable pair for Node 26\.13\.0/);
  assert.equal(realpathSync(join(tree,'third_party/node')),join(old,'third_party/node'),'a rejected selection mutates no old link');
  assert.equal(existsSync(join(tree,'third_party/node-source')),false);
});

test('symlinked acquisition roots become independent snapshots without ignored scratch',t=>{
  const {root,old,cache,table}=scratch(t),reference=join(root,'reference');candidate(old,reference);
  mkdirSync(join(reference,'third_party'),{recursive:true});
  const node=join(old,'third_party/node'),source=join(old,'third_party/node-source');
  symlinkSync(node,join(reference,'third_party/node'));symlinkSync(source,join(reference,'third_party/node-source'));
  mkdirSync(join(node,'target/stale'),{recursive:true});symlinkSync('cycle',join(node,'target/stale/cycle'));
  const pair=acquire(reference,cache,table),saved=inventory(join(pair,'node'));
  for(const name of ['node','node-source'])assert.equal(lstatSync(join(pair,name)).isSymbolicLink(),false);
  assert.equal(readlinkSync(join(pair,'node/lib/control-link.js')),'control.js');
  assert.equal(readlinkSync(join(pair,'node-source/deps/uv/source-link.c')),'source.c');
  assert.equal(existsSync(join(pair,'node/target')),false);
  const moved=join(root,'moved-node'),movedSource=join(root,'moved-source');renameSync(node,moved);renameSync(source,movedSource);
  writeFileSync(join(moved,'lib/control.js'),'changed origin');
  writeFileSync(join(movedSource,'deps/uv/source.c'),'changed native origin');
  assert.deepEqual(inventory(join(pair,'node')),saved);
  rmSync(moved,{recursive:true,force:true});rmSync(movedSource,{recursive:true,force:true});
  const tree=join(root,'candidate');candidate(reference,tree);assert.equal(link(tree,cache,table),pair);
  assert.deepEqual(inventory(join(pair,'node')),saved,'removing both origins cannot change or remove the pair');
  assert.equal(readFileSync(join(pair,'node-source/deps/uv/source-link.c'),'utf8'),'24.20.0 uv\n');
});

test('a published root symlink is rejected even when its target bytes match',t=>{
  const {root,old,cache,table}=scratch(t),pair=acquire(old,cache,table),tree=join(root,'candidate');candidate(old,tree);
  chmodSync(pair,0o755);
  for(const name of ['node','node-source']){
    const path=join(pair,name),saved=path+'.saved';renameSync(path,saved);symlinkSync(join(old,'third_party',name),path);
    assert.throws(()=>link(tree,cache,table),/root is not a snapshot directory/);unlinkSync(path);renameSync(saved,path);
  }
});

test('unknown versions, mismatched pairs, recipe versions and changed bytes fail by name',t=>{
  const {root,old,next,cache,table}=scratch(t);const a=acquire(old,cache,table);acquire(next,cache,table);
  const tree=join(root,'candidate');candidate(old,tree);
  writeFileSync(join(tree,'.tool-versions'),'nodejs 27.0.0\n');assert.throws(()=>link(tree,cache,table),/no recorded source identities for Node 27\.0\.0/);
  writeFileSync(join(tree,'.tool-versions'),'nodejs 24.20.0\n');
  const manifest=join(a,'pair.json'),saved=readFileSync(manifest);chmodSync(manifest,0o644);
  writeFileSync(manifest,saved.toString().replace('"release": "24.20.0"','"release": "26.13.0"'));
  assert.throws(()=>link(tree,cache,table),/mismatched immutable pair for Node 24\.20\.0/);writeFileSync(manifest,saved);
  writeFileSync(join(tree,'build/node-deps/recipes.json'),readFileSync(join(next,'build/node-deps/recipes.json')));
  assert.throws(()=>link(tree,cache,table),/recipe Node 26\.13\.0 differs from tree pin 24\.20\.0/);
  candidate(old,tree);const file=join(a,'node/lib/control.js');chmodSync(file,0o644);writeFileSync(file,'modified');
  assert.throws(()=>link(tree,cache,table),/immutable node bytes changed/);
  assert.equal(a,pairPath('24.20.0',table.releases['24.20.0']!,cache));
});

test('composition selects the candidate pin and refuses private-directory replacement',t=>{
  const {root,old,next,cache,table}=scratch(t);const a=acquire(old,cache,table),b=acquire(next,cache,table);
  const tree=join(root,'composition');candidate(old,tree);assert.equal(link(tree,cache,table),a);
  candidate(next,tree);assert.equal(link(tree,cache,table),b);
  assert.equal(realpathSync(join(tree,'third_party/node')),join(b,'node'));
  assert.throws(()=>link(next,cache,table),/refusing to replace private input directory/);
});
