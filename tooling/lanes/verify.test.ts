import {test} from "node:test";
import assert from "node:assert/strict";
import {spawn,spawnSync,execFileSync} from "node:child_process";
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setTimeout as sleep} from "node:timers/promises";
import {VerificationLedger,readLedger} from "./verification-ledger.ts";

const verifier=new URL("./verify.ts",import.meta.url).pathname;
function fixture(t:{after(fn:()=>void):void}) {
  const directory=mkdtempSync(join(tmpdir(),"shadow-verify-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const repo=join(directory,"repo"),home=join(directory,"home"),state=join(home,".cache/nts-land"),store=join(state,"verification");
  mkdirSync(join(repo,"tooling/gate"),{recursive:true});mkdirSync(home);
  const env:NodeJS.ProcessEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith("NTS_") && !k.startsWith("GIT_")));
  Object.assign(env,{NTS_LAND_HOME:home,GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t"});
  const git=(...args:string[])=>execFileSync("git",args,{cwd:repo,env,encoding:"utf8"}).trim();
  writeFileSync(join(repo,"tooling/gate/owed.mjs"),'process.stdout.write(\'NTS_GATE_STEPS="fake" sh tooling/gate/all.sh\\n\');\n');
  writeFileSync(join(repo,"tooling/gate/run.mjs"),'process.stdout.write(JSON.stringify({fake:[]}));\n');
  writeFileSync(join(repo,"tooling/gate/pinned.sh"),`set -eu
# nts-gate-tree-lock-handoff: 8
exec 9>&8
flock -n 9
if [ -e "$NTS_GATE_TREE/.git" ]; then git -C "$NTS_GATE_TREE" checkout -q --detach --force "$1"; else git worktree add -q --detach "$NTS_GATE_TREE" "$1"; fi
[ -n "\${NTS_GATE_SETUP_ONLY:-}" ] && exit 0
if [ -n "\${SHADOW_TEST_WAIT:-}" ]; then
 touch "$SHADOW_TEST_WAIT"
 while [ ! -f "$SHADOW_TEST_WAIT.done" ]; do sleep 0.02; done
fi
verdict=green step=PASS
if [ -n "\${SHADOW_TEST_RED:-}" ]; then verdict=red step=FAIL; fi
printf '{"verdict":"%s","identities":{"commit":"%s"},"requested":["fake"],"steps":[{"name":"fake","verdict":"%s"}]}' "$verdict" "$1" "$step" > "$NTS_GATE_RUN_DIR/summary.json"
if [ -n "\${SHADOW_TEST_BAD_EXIT:-}" ]; then exit 17; fi
[ "$verdict" = green ]
`);
  git("init","-qb","main");git("add","tooling");git("commit","-qm","base");
  const initial=git("rev-parse","HEAD");new VerificationLedger(store,repo,initial);
  const append=(name:string)=>{
    const base=git("rev-parse","HEAD"),l=new VerificationLedger(store,repo,base);
    writeFileSync(join(repo,name),name);git("add",name);git("commit","-qm",name);const tip=git("rev-parse","HEAD");
    const checks={steps:["fake"],interop:null};
    const id=l.prepare(base,tip,[{id:tip,submitted:tip,base,tip,author:{lane:"tsrs",address:null},owed:checks}],"strict",{commit:tip,run:`/strict/${tip}`,checks});
    l.commit(id,tip);return tip;
  };
  const start=()=>{
    const child=spawn(process.execPath,[verifier],{cwd:repo,env});let out="";
    child.stdout.on("data",d=>out+=d);child.stderr.on("data",d=>out+=d);
    return {child,done:new Promise<{status:number|null;out:string}>(resolve=>child.on("close",status=>resolve({status,out})))};
  };
  return {repo,home,state,store,env,git,append,start};
}

test("a manual shadow uses frozen union and reports agreement with strict trains",async t=>{
  const f=fixture(t),tip=f.append("one"),result=await f.start().done;
  assert.equal(result.status,0,result.out);assert.match(result.out,/green; agree with original trains/);
  const saved=readLedger(f.store)!,batch=saved.shadow!.batches[0];
  assert.equal(batch.tip,tip);assert.deepEqual(batch.checks.steps,["fake"]);
  assert.equal(batch.expected,"green");assert.equal(saved.mode,"strict");
  assert.equal(f.git("rev-parse","main"),tip);
  const again=await f.start().done;assert.match(again.out,/no new landed range/);
});

test("queued work defers a shadow without launching any gate",async t=>{
  const f=fixture(t);f.append("one");mkdirSync(join(f.state,"queue"),{recursive:true});
  writeFileSync(join(f.state,"queue/waiting.json"),"{}");
  const result=await f.start().done;assert.equal(result.status,0,result.out);assert.match(result.out,/deferred/);
  assert.equal(readLedger(f.store)!.shadow,undefined);
});

test("shadow RED holds and never changes the landed tip",async t=>{
  const f=fixture(t),tip=f.append("one");f.env.SHADOW_TEST_RED="1";
  const result=await f.start().done;assert.equal(result.status,1,result.out);assert.match(result.out,/red; disagree/);
  assert.equal(f.git("rev-parse","main"),tip);assert.equal(readLedger(f.store)!.shadow!.batches[0].state,"held");
});

test("a green summary with a failed gate process cannot certify a shadow batch",async t=>{
  const f=fixture(t);f.append("one");f.env.SHADOW_TEST_BAD_EXIT="1";
  const result=await f.start().done;assert.equal(result.status,1,result.out);
  const batch=readLedger(f.store)!.shadow!.batches[0];
  assert.equal(batch.state,"held");assert.equal(batch.verdict,"red");
  assert.equal(JSON.parse(readFileSync(join(batch.run!,"process.json"),"utf8")).status,17);
});

test("shadow releases the landing lock while its frozen batch is running",async t=>{
  const f=fixture(t),tip=f.append("one"),wait=join(f.home,"wait");f.env.SHADOW_TEST_WAIT=wait;
  const running=f.start();
  const end=Date.now()+15000;while (!existsSync(wait) && Date.now()<end) await sleep(20);
  assert.ok(existsSync(wait),"stand-in gate started");
  const duplicate=await f.start().done;
  assert.equal(duplicate.status,0,duplicate.out);assert.match(duplicate.out,/another shadow batch/);
  assert.equal(spawnSync("flock",["-n",join(f.home,".cache/nts-land.lock"),"true"]).status,0);
  const second=f.append("two");writeFileSync(wait+".done","");
  const result=await running.done;assert.equal(result.status,0,result.out);
  const saved=readLedger(f.store)!;
  assert.equal(saved.shadow!.batches[0].tip,tip);assert.equal(saved.observedMain,second);
  assert.equal(saved.transactions.length,2);
});
