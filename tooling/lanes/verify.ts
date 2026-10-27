// One manually requested shadow batch. This never lands or reverts anything.
// There is deliberately no daemon/optimistic switch in this rollout stage.
import {spawnSync} from "node:child_process";
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {GateResource,supportsResourceHandoff} from "./gate-resource.ts";
import {holdsLandingLock,ledgerAt,runShadowGate,sharedCheckout} from "./land.ts";
import {shadowStepVerdicts,type ShadowBatch,type ShadowResult} from "./verification-ledger.ts";

const home=process.env.NTS_LAND_HOME ?? homedir();
const state=join(home,".cache/nts-land"),lock=join(home,".cache/nts-land.lock");
const gateLock=join(home,".cache/nts-parallel-20261004/mainctl/gate-tree.lock");
const self=new URL(import.meta.url).pathname;
const root=sharedCheckout();
const main=()=>{
  const result=spawnSync("git",["rev-parse","main"],{cwd:root,encoding:"utf8"});
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};
const queued=()=>existsSync(join(state,"queue")) && readdirSync(join(state,"queue")).some(f=>f.endsWith(".json"));
function locked(): void {if (!holdsLandingLock()) throw new Error("shadow state mutation requires the landing lock");}

async function run(): Promise<void> {
  const [operation,...extra]=process.argv.slice(2);
  if (operation === "--snapshot") {
    if (extra.length) throw new Error("invalid shadow snapshot invocation");
    locked();
    if (!GateResource.inherited(gateLock)) throw new Error("shadow snapshot lacks the gate resource");
    // status.json is output, not lock authority; a dead writer may leave it
    // saying gating. Actual lock/queue ownership is the admission condition.
    if (queued()) {process.exitCode=75;return;}
    const batch=ledgerAt(root,main()).beginShadow(main());
    process.stdout.write(JSON.stringify(batch));return;
  }
  if (operation === "--finish") {
    locked();
    const [id,...rest]=extra;
    if (!id || rest.length || !/^[a-f0-9-]+$/.test(id)) throw new Error("invalid shadow completion invocation");
    const result=JSON.parse(readFileSync(join(state,"verification/shadow",id,"outcome.json"),"utf8"));
    const batch=ledgerAt(root,main()).finishShadow(id,result,main());
    process.stdout.write(JSON.stringify(batch));return;
  }
  if (operation || extra.length) throw new Error("usage: node tooling/lanes/verify.ts (one manual shadow batch)");
  if (!supportsResourceHandoff(root)) throw new Error("shared pinned.sh does not support shadow resource locking yet");
  mkdirSync(state,{recursive:true});
  const ownership=GateResource.tryAcquire(join(state,"verification/shadow.lock"));
  if (!ownership) {console.log("verify: deferred; another shadow batch owns verification");return;}
  try {
  if (queued()) {console.log("verify: deferred; a landing is queued");return;}
  const resource=GateResource.tryAcquire(gateLock);
  if (!resource) {console.log("verify: deferred; the gate resource is in use");return;}
  let batch:ShadowBatch|null=null;
  try {
    const snapshot=spawnSync("flock",["-n","-E","75",lock,process.execPath,self,"--snapshot"],
      {cwd:root,env:resource.env(),stdio:resource.stdio("pipe"),encoding:"utf8"});
    if (snapshot.status === 75) {console.log("verify: deferred; a landing is queued or holds the lock");return;}
    if (snapshot.status !== 0) throw new Error(snapshot.stderr || "cannot snapshot shadow batch");
    batch=JSON.parse(snapshot.stdout);
    if (!batch) {console.log("verify: no new landed range to shadow");return;}
    const directory=join(state,"verification/shadow",batch.id);mkdirSync(directory,{recursive:true});
    console.log(`verify: shadow ${batch.id}, ${batch.base.slice(0,12)}..${batch.tip.slice(0,12)}; original trains ${batch.expected}`);
    writeFileSync(join(directory,"snapshot.json"),JSON.stringify(batch,null,2)+"\n");
    let result:ShadowResult;
    try {
      // Native spawnSync closes unspecified descriptors; retain this exact
      // lock description when the common gate enters pinned.sh.
      // The parent owns resource.fd; expose fd 8 in a child instead of relying
      // on Node's own allocator to have returned that number.
      const worker=spawnSync(process.execPath,[self,"--gate",batch.id],
        {cwd:root,env:resource.env(),stdio:resource.stdio("inherit")});
      const outcome=join(directory,"outcome.json");
      result=existsSync(outcome) ? JSON.parse(readFileSync(outcome,"utf8"))
        : {ok:false,run:"",message:`shadow worker interrupted or failed before recording a verdict (exit ${worker.status}, signal ${worker.signal})`};
    } catch (error) {result={ok:false,run:"",message:`shadow setup failure: ${String(error)}`};}
    writeFileSync(join(directory,"outcome.json"),JSON.stringify(result,null,2)+"\n");
  } finally {resource.close();}
  // Release the resource BEFORE waiting for the landing lock again. This
  // also lets an older lander holding that lock finish its pinned.sh wait.
  if (!batch) return;
  const finished=spawnSync("flock",[lock,process.execPath,self,"--finish",batch.id],{cwd:root,env:process.env,encoding:"utf8"});
  if (finished.status !== 0) throw new Error(finished.stderr || "shadow completion needs restart recovery");
  const result=JSON.parse(finished.stdout) as ShadowBatch;
  console.log(`verify: ${result.verdict}; ${result.agreement} with original trains; ${result.run || result.message}`);
  if (result.landings) console.log(`verify: landings ${["agree","disagree","unavailable","no-expectation"].map(a=>`${a}=${result.landings!.filter(e=>e.agreement === a).length}`).join(" ")}`);
  if (result.state !== "agreed" || result.verdict !== "green") process.exitCode=1;
  } finally {ownership.close();}
}

try {
  if (process.argv[2] === "--gate") {
    const id=process.argv[3];
    if (!/^[a-f0-9-]+$/.test(id) || process.argv.length !== 4) throw new Error("invalid shadow gate invocation");
    if (!GateResource.inherited(gateLock)) throw new Error("shadow gate lacks its resource lock");
    const directory=join(state,"verification/shadow",id);
    const batch=JSON.parse(readFileSync(join(directory,"snapshot.json"),"utf8")) as ShadowBatch;
    const result:ShadowResult=runShadowGate(root,batch.base,batch.tip,batch.checks);
    if (result.run) {
      try {
        const summary=JSON.parse(readFileSync(join(result.run,"summary.json"),"utf8"));
        const process=JSON.parse(readFileSync(join(result.run,"process.json"),"utf8"));
        result.stepVerdicts=shadowStepVerdicts(batch.tip,result.ok,summary,process);
      } catch { /* Missing or malformed evidence leaves comparisons unavailable. */ }
    }
    writeFileSync(join(directory,"outcome.json"),JSON.stringify(result,null,2)+"\n");
  } else await run();
} catch (error) {
  console.error(`verify: ${String(error)}`);process.exitCode=1;
}
