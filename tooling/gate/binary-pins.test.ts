import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,mkdirSync,readFileSync,readdirSync,rmSync,statSync,utimesSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test,type TestContext} from 'node:test';
import {binaryPinWarnings,pinBinaries,observePinOwner,type PinOwnerObservation} from './binary-pins.ts';
import {processIdentity} from '../landing/lock.ts';
import {testScratch} from './test-scratch.ts';
import {count,type CountInput} from '../full-check/count.ts';
import {pathToFileURL} from 'node:url';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {generatedJavaScript} from './generated-javascript.ts';
import {lockChild} from '../landing/lock-fixture.ts';

function fixture(t:TestContext){
  const cache=testScratch(t,'binary-pins'),root=join(cache,'nts-gate','bin-v2');mkdirSync(root,{recursive:true});
  const source=join(cache,'compiler');writeFileSync(source,'compiler');
  const hash=createHash('sha256').update('compiler').digest('hex');
  const bundle=createHash('sha256').update(JSON.stringify([['nts',hash]])).digest('hex');
  const acquire=(observe?:PinOwnerObservation)=>pinBinaries({root,hash,run:join(cache,'run'),binaries:{nts:source},observe,now:()=>0,wallNow:()=>100_000});
  const age=(dir:string,time:number)=>utimesSync(dir,new Date(time),new Date(time));
  const seed=(n:number)=>Array.from({length:n},(_,i)=>{
    const dir=join(root,i.toString(16).padStart(64,'0'));mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'nts'),'old compiler');age(dir,i*1000);return dir;
  });
  return {cache,root,source,hash,bundle,acquire,age,seed};
}

test('oldest live pin survives eleven newer pins; next oldest unheld pin is pruned',t=>{
  const f=fixture(t),held=f.acquire(),oldest=join(f.root,f.bundle);f.age(oldest,0);
  const newer=f.seed(11);
  // Twelve folders exist before a later run starts. Its publication and
  // retention transaction must preserve the old executable, without touching it.
  writeFileSync(f.source,'later compiler');
  const later=pinBinaries({root:f.root,hash:createHash('sha256').update('later compiler').digest('hex'),run:join(f.cache,'later'),
    binaries:{nts:f.source},now:()=>0,wallNow:()=>100_000});
  assert.equal(readFileSync(join(oldest,'nts'),'utf8'),'compiler');
  assert.equal(existsSync(newer[0]!),false);
  for(const dir of newer.slice(1))assert.equal(existsSync(dir),true);
  assert.equal(existsSync(later.paths.nts!),true);
  held.release();assert.equal(existsSync(oldest),false,'ended runs no longer keep the oldest pin');
  later.release();
});

test('twelve folders with two held and ten unheld prune nothing',t=>{
  const f=fixture(t),held=f.acquire(),oldest=join(f.root,f.bundle);f.age(oldest,0);
  const newer=f.seed(10);writeFileSync(f.source,'later compiler');
  const later=pinBinaries({root:f.root,hash:createHash('sha256').update('later compiler').digest('hex'),run:join(f.cache,'later'),
    binaries:{nts:f.source},now:()=>0,wallNow:()=>100_000});
  for(const dir of [oldest,...newer])assert.equal(existsSync(dir),true);
  assert.equal(existsSync(later.paths.nts!),true);
  held.release();later.release();
});

test('the pre-lease count-only pruner cannot reach the sibling versioned cache',t=>{
  const f=fixture(t),held=f.acquire(),newer=f.seed(11),legacy=join(f.cache,'nts-gate','bin');
  mkdirSync(legacy,{recursive:true});
  for(let i=0;i<12;i++){const dir=join(legacy,i.toString(16).padStart(64,'0'));mkdirSync(dir);writeFileSync(join(dir,'nts'),'legacy compiler');f.age(dir,i*1000);}
  const hash='b'.repeat(64),dir=join(legacy,hash);mkdirSync(dir);f.age(dir,100_000);
  // The count-only pruning block from run.mjs before #907. The fixture supplies
  // its wall timestamp; every enumeration and removal is the original logic.
  const all = readdirSync(legacy).map((n) => ({ n, t: statSync(join(legacy, n)).mtimeMs })).sort((a, b) => b.t - a.t);
  utimesSync(dir, new Date(100_000), new Date(100_000));
  for (const old of all.slice(10)) if (old.n !== hash) rmSync(join(legacy, old.n), { recursive: true, force: true });
  assert.equal(readdirSync(legacy).length,10,'the old code really pruned its own cache');
  assert.equal(readFileSync(held.paths.nts!,'utf8'),'compiler');
  for(const pin of newer)assert.equal(existsSync(pin),true,'legacy pruning cannot reach a v2 folder');
  assert.equal(readdirSync(join(f.root,f.bundle,'holders')).length,1);
  const counted=count({plan:'',local:[],remote:[],pulls:[],issues:[],recordCitations:[],worktrees:[],shared:f.cache,cache:f.cache,
    root:f.cache,main:null,verified:null,slices:[],activeUnits:[],now:0},{'nts-gate':{kind:'kept',why:'fixture'}});
  assert.equal(counted.notices?.filter(line=>line.includes('legacy gate pin')).length,10);
  assert.equal(counted.verdict,'PASS','a legacy leftover awaiting a decision is a notice, not a failure');
  assert.deepEqual(counted.removable,[],'no existing age rule can prove a legacy holder gone');
  held.release();
});

test('a provably gone PID is reclaimed and the old unheld folder pruned',t=>{
  const f=fixture(t),[oldest]=f.seed(11),directory=join(oldest!,'holders');mkdirSync(directory);
  const identity='00000000-0000-0000-0000-000000000000 2147483647 1';
  writeFileSync(join(directory,'dead.json'),JSON.stringify({version:1,run:'/old-run',token:'dead',identity,pid:2147483647}));
  f.age(oldest!,0);
  assert.equal(observePinOwner(2147483647,identity),'gone');
  const held=f.acquire();assert.equal(existsSync(oldest!),false);held.release();
});

test('a reused live PID does not preserve the former process birth',()=>{
  const identity=processIdentity(process.pid)!;assert.ok(identity);
  assert.equal(observePinOwner(process.pid,identity),'live');
  assert.equal(observePinOwner(process.pid,identity.replace(/ [0-9]+$/,' 0')),'gone');
});

test('unknown, corrupt and future holder state protects its pin and count names it',t=>{
  const f=fixture(t),old=f.seed(13),identity=processIdentity(process.pid)!.replace(/ [0-9]+$/,' 0');
  const rows=[{version:1,run:'/unknown-run',token:'unknown',identity,pid:process.pid},{version:2},null];
  for(const [i,row]of rows.entries()){
    mkdirSync(join(old[i]!,'holders'));writeFileSync(join(old[i]!,'holders','holder.json'),JSON.stringify(row));f.age(old[i]!,i*1000);
  }
  const observe:PinOwnerObservation=(pid,identity)=>identity===rows[0]!.identity?'unknown':observePinOwner(pid,identity),held=f.acquire(observe);
  for(const dir of old.slice(0,3))assert.equal(existsSync(dir),true);
  const warnings=binaryPinWarnings(f.root,observe);assert.equal(warnings.length,3);
  for(const dir of old.slice(0,3))assert.ok(warnings.some(line=>line.includes(dir)));
  // Production count uses the same diagnostics, including readable corrupt or
  // future leases. No count result grants deletion of these folders.
  const input:CountInput={plan:'',local:[],remote:[],pulls:[],issues:[],recordCitations:[],worktrees:[],shared:f.cache,
    cache:f.cache,root:f.cache,main:null,verified:null,slices:[],activeUnits:[],now:0,pinOwnerObservation:observe};
  const counted=count(input,{'nts-gate':{kind:'kept',why:'fixture cache'}});
  for(const dir of old.slice(0,3))assert.ok(counted.red.some(line=>line.includes(dir)));
  assert.deepEqual(counted.removable,[]);held.release();
});

test('release checks exact holder identity, is idempotent and preserves another holder',t=>{
  const f=fixture(t),first=f.acquire(),second=f.acquire(),dir=join(f.root,f.bundle,'holders');
  assert.equal(readdirSync(dir).length,2);first.release();first.release();assert.equal(readdirSync(dir).length,1);
  const path=join(dir,readdirSync(dir)[0]!),original=readFileSync(path,'utf8');
  writeFileSync(path,original.replace('"version": 1','"version": 2'));
  assert.throws(()=>second.release(),/future holder version/);
  writeFileSync(path,original);second.release();assert.deepEqual(readdirSync(dir),[]);
});

test('staging detects a changed compiler before publishing paths or a lease',t=>{
  const f=fixture(t);writeFileSync(f.source,'different compiler');
  assert.throws(()=>f.acquire(),/compiler changed while staging/);
  assert.deepEqual(readdirSync(f.root),[]);
});

test('complete bundle identity separates suite-only changes and reuses identical immutable members',t=>{
  const f=fixture(t),suite=join(f.cache,'suite');writeFileSync(suite,'suite one');
  const acquire=(reverse=false)=>pinBinaries({root:f.root,hash:f.hash,run:join(f.cache,'run'),
    binaries:reverse?{'nts-suite':suite,nts:f.source}:{nts:f.source,'nts-suite':suite},now:()=>0,wallNow:()=>100_000});
  const first=acquire(),oldSuite=first.paths['nts-suite']!,before=statSync(oldSuite);
  const pairs=Object.entries(first.members).sort(([a],[b])=>a<b?-1:a>b?1:0);
  assert.equal(first.bundleSha256,createHash('sha256').update(JSON.stringify(pairs)).digest('hex'));
  const same=acquire(true);assert.equal(same.bundleSha256,first.bundleSha256);assert.deepEqual(same.paths,first.paths);
  assert.equal(statSync(oldSuite).ino,before.ino);assert.equal(statSync(oldSuite).mtimeMs,before.mtimeMs);
  writeFileSync(suite,'suite two');const changed=acquire();
  assert.notEqual(changed.bundleSha256,first.bundleSha256);assert.notEqual(changed.paths.nts,first.paths.nts);
  assert.equal(changed.members.nts,first.members.nts,'compiler provenance remains its actual digest');
  assert.equal(readFileSync(oldSuite,'utf8'),'suite one');assert.equal(readFileSync(changed.paths['nts-suite']!,'utf8'),'suite two');
  same.release();changed.release();first.release();
});

test('reuse checks every member digest and never repairs or overwrites a mismatching executable',t=>{
  const f=fixture(t),first=f.acquire(),path=first.paths.nts!;
  chmodSync(path,0o755);writeFileSync(path,'corrupted pin');chmodSync(path,0o555);
  const before=statSync(path);
  assert.throws(()=>f.acquire(),/pinned bundle member digest mismatch/);
  assert.equal(readFileSync(path,'utf8'),'corrupted pin');assert.equal(statSync(path).ino,before.ino);
  assert.equal(readdirSync(join(f.root,first.bundleSha256,'holders')).length,1,'failed reuse releases only its own holder');
  first.release();
});

const PIN_CHILD=generatedJavaScript(`import {readSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {pinBinaries}=await import(process.argv[1]);
process.stdout.write('ready\\n');readSync(0,Buffer.alloc(1),0,1,null);
const source=process.argv[3],hash=createHash('sha256').update(readFileSync(source)).digest('hex');
const held=pinBinaries({root:process.argv[2],hash,run:process.argv[4],binaries:{nts:source},now:()=>0,wallNow:()=>100000});
process.stdout.write('held:'+JSON.stringify(held.paths)+'\\n');readSync(0,Buffer.alloc(1),0,1,null);
held.release();`);

test('24 simultaneous starts publish complete leases and serialize release and retention',async t=>{
  const f=fixture(t),stage=join(f.cache,'stage');copyModuleClosure(['tooling/gate/binary-pins.ts'],stage);
  const entry=pathToFileURL(join(stage,'tooling/gate/binary-pins.ts')).href;
  const children=Array.from({length:24},(_,i)=>{
    const source=join(f.cache,'compiler-'+i);writeFileSync(source,'compiler '+i);
    return lockChild(t,PIN_CHILD,[entry,f.root,source,join(f.cache,'run-'+i)]);
  });
  await Promise.all(children.map(child=>child.wait('ready')));
  for(const child of children)child.child.stdin.write('g');
  await Promise.all(children.map(child=>child.wait('held:')));
  const dirs=readdirSync(f.root).filter(name=>/^[0-9a-f]{64}$/.test(name));assert.equal(dirs.length,24);
  for(const dir of dirs){assert.equal(readdirSync(join(f.root,dir,'holders')).length,1);assert.ok(readFileSync(join(f.root,dir,'nts')).length);}
  for(const child of children)child.child.stdin.end();
  assert.deepEqual(await Promise.all(children.map(child=>child.closed)),Array(24).fill(0));
  assert.equal(readdirSync(f.root).filter(name=>/^[0-9a-f]{64}$/.test(name)).length,10);
  assert.deepEqual(binaryPinWarnings(f.root),[]);
});
