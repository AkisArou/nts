import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { covers, declaredShadowSteps, readLedger, shadowStepVerdicts, VerificationLedger, type Checks } from "./verification-ledger.ts";

function scratch(t: {after(fn: () => void): void}) {
  const root = mkdtempSync(join(tmpdir(), "verification-ledger-"));
  t.after(() => rmSync(root, {recursive:true,force:true}));
  const repo = join(root,"repo"), directory = join(root,"verification"); mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git",args,{cwd:repo,encoding:"utf8",env:{...process.env,GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t"}}).trim();
  git("init","-q","-b","main");
  const commit = (text: string) => {writeFileSync(join(repo,"source"),text);git("add","source");git("commit","-qm",text);return git("rev-parse","HEAD");};
  const base=commit("base"); git("switch","-qc","topic");
  const ledger=()=>new VerificationLedger(directory,repo,base);
  return {repo,directory,git,commit,base,ledger};
}
const tests: Checks = {steps:["tests"],interop:null};
const all: Checks = {steps:"all",interop:null};
const entry=(base:string,tip:string,owed=tests)=>({id:tip,submitted:tip,base,tip,author:{lane:"tsrs",address:null},owed});
const proof=(tip:string,checks=tests)=>({commit:tip,run:"/ordinary/gate/run",checks});

test("a crash before FF aborts prepared bookkeeping without moving main", t=>{
  const s=scratch(t),tip=s.commit("change"),l=s.ledger();
  l.prepare(s.base,tip,[entry(s.base,tip)],"strict",proof(tip));
  const restarted=s.ledger(); restarted.recover(s.base);
  assert.equal(restarted.state.transactions[0].state,"aborted");
  assert.equal(restarted.state.verified.tip,s.base);
  assert.equal(s.git("rev-parse","main"),s.base);
});

test("a crash after FF recovers the exact committed range and is idempotent",t=>{
  const s=scratch(t),tip=s.commit("change"),l=s.ledger();
  l.prepare(s.base,tip,[entry(s.base,tip)],"strict",proof(tip));
  s.git("update-ref","refs/heads/main",tip,s.base);
  const restarted=s.ledger(); restarted.recover(tip);
  assert.equal(restarted.state.transactions[0].state,"committed");
  assert.deepEqual(restarted.state.transactions[0].entries[0].commits,[tip]);
  assert.equal(restarted.state.verified.tip,tip);
  const once=JSON.stringify(restarted.state); restarted.recover(tip);
  assert.equal(JSON.stringify(restarted.state),once);
  assert.equal(readLedger(s.directory)!.mode,"strict");
});

test("external movement remains unverified until an actual gate covers it",t=>{
  const s=scratch(t),external=s.commit("external"),l=s.ledger();
  s.git("update-ref","refs/heads/main",external,s.base); l.recover(external);
  assert.equal(l.state.transactions[0].kind,"external");
  const partial=s.commit("partial"),id=l.prepare(external,partial,[entry(external,partial)],"strict",proof(partial));
  s.git("update-ref","refs/heads/main",partial,external);l.commit(id,partial);
  assert.equal(l.state.verified.tip,s.base,"partial proof cannot skip an unknown ancestor");
  const full=s.commit("full"),next=l.prepare(partial,full,[entry(partial,full)],"strict",proof(full,all));
  s.git("update-ref","refs/heads/main",full,partial);l.commit(next,full);
  assert.equal(l.state.verified.tip,full);
  assert.ok(l.state.transactions.every(tx=>tx.entries.every(e=>e.state==="verified")));
});

test("proof includes interop/doctest scope and must name the exact tip",t=>{
  assert.equal(covers({steps:["interop"],interop:"a"},{steps:["interop"],interop:"b"}),false);
  assert.equal(covers({steps:["interop"],interop:"a"},{steps:["interop"],interop:null}),false);
  assert.equal(covers({steps:["doctests"],interop:null,doctests:"nts-core"},{steps:["doctests"],interop:null,doctests:"nts-cli"}),false);
  const s=scratch(t),tip=s.commit("change"),l=s.ledger();
  assert.throws(()=>l.prepare(s.base,tip,[entry(s.base,tip)],"strict",proof(s.base)),/exact tip/);
  assert.equal(readLedger(s.directory)!.transactions.length,0);
  const id=l.prepare(s.base,tip,[entry(s.base,tip,all)],"strict",proof(tip));
  s.git("update-ref","refs/heads/main",tip,s.base);l.commit(id,tip);
  assert.equal(l.state.transactions[0].entries[0].state,"unverified");
  assert.equal(l.state.verified.tip,s.base,"narrow strict proof cannot certify broader per-member obligations");
});

test("a docs-only external range is covered by the next strict train's tree checks",t=>{
  const s=scratch(t),treeChecks:Checks={steps:["rustfmt","old-paths"],interop:null};
  const l=new VerificationLedger(s.directory,s.repo,s.base,(base,tip)=>{
    assert.equal(base,s.base); assert.equal(tip,s.git("rev-parse","HEAD")); return treeChecks;
  });
  mkdirSync(join(s.repo,"docs"));writeFileSync(join(s.repo,"docs/design.md"),"current design\n");
  s.git("add","docs/design.md");s.git("commit","-qm","coordinator docs");const doc=s.git("rev-parse","HEAD");
  s.git("update-ref","refs/heads/main",doc,s.base);l.recover(doc);
  assert.deepEqual(l.state.transactions[0].entries[0].owed,treeChecks);
  assert.equal(l.state.transactions[0].entries[0].author.lane,"coordinator");
  assert.equal(l.state.verified.tip,s.base);
  const tip=s.commit("strict train"),actual:Checks={steps:["tests","rustfmt","old-paths"],interop:null};
  const id=l.prepare(doc,tip,[entry(doc,tip)],"strict",proof(tip,actual));
  s.git("update-ref","refs/heads/main",tip,doc);l.commit(id,tip);
  assert.equal(l.state.verified.tip,tip);
  assert.ok(l.state.transactions.every(tx=>tx.entries.every(e=>e.state==="verified")));
});

test("corrupt or future state is preserved instead of resetting trust",t=>{
  const s=scratch(t);s.ledger();const file=join(s.directory,"ledger.json");
  for(const text of ["{",JSON.stringify({...readLedger(s.directory),version:2}),JSON.stringify({...readLedger(s.directory),mode:"optimistic"})]){
    writeFileSync(file,text);assert.throws(()=>s.ledger(),/cannot read verification ledger/);
    assert.equal(readFileSync(file,"utf8"),text);
  }
});

test("an interrupted prepared landing cannot certify divergent main",t=>{
  const s=scratch(t),tip=s.commit("change"),l=s.ledger();l.prepare(s.base,tip,[entry(s.base,tip)],"strict",proof(tip));
  const other=execFileSync("git",["commit-tree",s.git("rev-parse",`${s.base}^{tree}`)],{cwd:s.repo,encoding:"utf8",input:"unrelated history\n",env:{...process.env,GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t"}}).trim();
  assert.throws(()=>s.ledger().recover(other),/main diverged/);
  assert.equal(readLedger(s.directory)!.transactions[0].state,"held");
  assert.equal(readLedger(s.directory)!.verified.tip,s.base);
});

test("a shadow snapshot is bounded while a later strict landing reaches main",t=>{
  const s=scratch(t),l=s.ledger(),first=s.commit("one");
  const id=l.prepare(s.base,first,[entry(s.base,first)],"strict",proof(first));
  s.git("update-ref","refs/heads/main",first,s.base);l.commit(id,first);
  const batch=l.beginShadow(first)!;
  assert.equal(batch.expected,"green");assert.deepEqual(batch.entries,[first]);
  const second=s.commit("two"),next=l.prepare(first,second,[entry(first,second)],"strict",proof(second));
  s.git("update-ref","refs/heads/main",second,first);l.commit(next,second);
  const done=l.finishShadow(batch.id,{ok:true,run:"/shadow/one",stepVerdicts:{tests:"green"}},second);
  assert.equal(done.tip,first);assert.equal(done.agreement,"agree");
  const later=l.beginShadow(second)!;
  assert.equal(later.base,first);assert.equal(later.tip,second);assert.deepEqual(later.entries,[second]);
});

test("a red shadow batch holds without changing main or reverting anyone",t=>{
  const s=scratch(t),l=s.ledger(),tip=s.commit("one"),id=l.prepare(s.base,tip,[entry(s.base,tip)],"strict",proof(tip));
  s.git("update-ref","refs/heads/main",tip,s.base);l.commit(id,tip);
  const batch=l.beginShadow(tip)!,done=l.finishShadow(batch.id,{ok:false,run:"/shadow/red",message:"instrument failure"},tip);
  assert.equal(done.state,"held");assert.equal(done.agreement,"unavailable");
  assert.equal(s.git("rev-parse","main"),tip);assert.equal(l.state.mode,"strict");
  assert.equal(l.state.shadow!.batches.filter(b=>b.state === "agreed").length,0);
});

test("coordinator tree-only docs have no expectation while proven landings agree",t=>{
  const s=scratch(t),tree:Checks={steps:["format"],interop:null};
  const l=new VerificationLedger(s.directory,s.repo,s.base,()=>tree,["format"]);
  const first=s.commit("proven"),id=l.prepare(s.base,first,[entry(s.base,first)],"strict",proof(first));
  s.git("update-ref","refs/heads/main",first,s.base);l.commit(id,first);
  mkdirSync(join(s.repo,"docs"));writeFileSync(join(s.repo,"docs/design.md"),"design\n");
  s.git("add","docs/design.md");s.git("commit","-qm","docs");const docs=s.git("rev-parse","HEAD");
  s.git("update-ref","refs/heads/main",docs,first);
  const batch=l.beginShadow(docs)!;
  assert.equal(batch.expected,"green");
  const done=l.finishShadow(batch.id,{ok:true,run:"/shadow/docs",stepVerdicts:{tests:"green",format:"green"}},docs);
  assert.deepEqual(done.landings!.map(e=>e.agreement),["agree","no-expectation"]);
  assert.equal(done.state,"agreed");assert.equal(l.state.verified.tip,docs);
});

test("each landing compares its original train scope, including inherited checks",t=>{
  const s=scratch(t),l=s.ledger(),first=s.commit("one");
  let id=l.prepare(s.base,first,[entry(s.base,first)],"strict",proof(first));
  s.git("update-ref","refs/heads/main",first,s.base);l.commit(id,first);
  const second=s.commit("two"),actual:Checks={steps:["tests","memory"],interop:null};
  id=l.prepare(first,second,[entry(first,second)],"strict",proof(second,actual));
  s.git("update-ref","refs/heads/main",second,first);l.commit(id,second);
  const batch=l.beginShadow(second)!;
  assert.deepEqual(batch.checks.steps,["tests","memory"]);
  const done=l.finishShadow(batch.id,{ok:false,run:"/shadow/red",stepVerdicts:{tests:"green",memory:"red"}},second);
  assert.deepEqual(done.landings!.map(e=>e.agreement),["agree","disagree"]);
  assert.equal(done.state,"held");assert.equal(done.agreement,"disagree");
});

test("docs alone do not count as a train comparison",t=>{
  const s=scratch(t),tree:Checks={steps:["format"],interop:null};
  const l=new VerificationLedger(s.directory,s.repo,s.base,()=>tree,["format"]);
  mkdirSync(join(s.repo,"docs"));writeFileSync(join(s.repo,"docs/design.md"),"design\n");
  s.git("add","docs/design.md");s.git("commit","-qm","docs");const tip=s.git("rev-parse","HEAD");
  s.git("update-ref","refs/heads/main",tip,s.base);
  const batch=l.beginShadow(tip)!,done=l.finishShadow(batch.id,{ok:true,run:"/shadow/docs-only",stepVerdicts:{format:"green"}},tip);
  assert.equal(done.landings![0].agreement,"no-expectation");
  assert.equal(done.agreement,"unavailable");assert.equal(done.state,"held");
  assert.equal(l.state.verified.tip,tip,"the actual green verdict still verifies docs");
});

test("unknown external changes are not silently excluded from agreement",t=>{
  const s=scratch(t),l=new VerificationLedger(s.directory,s.repo,s.base,()=>tests,["format"]);
  const first=s.commit("proven"),id=l.prepare(s.base,first,[entry(s.base,first)],"strict",proof(first));
  s.git("update-ref","refs/heads/main",first,s.base);l.commit(id,first);
  mkdirSync(join(s.repo,"docs"));writeFileSync(join(s.repo,"docs/code.md"),"owes a real test\n");
  s.git("add","docs/code.md");s.git("commit","-qm","docs needing tests");const tip=s.git("rev-parse","HEAD");
  s.git("update-ref","refs/heads/main",tip,first);
  const batch=l.beginShadow(tip)!,done=l.finishShadow(batch.id,{ok:true,run:"/shadow/unknown",stepVerdicts:{tests:"green"}},tip);
  assert.deepEqual(done.landings!.map(e=>e.agreement),["agree","unavailable"]);
  assert.equal(done.state,"held");
});

test("a full original train freezes its actual step list, not today's all",t=>{
  const s=scratch(t),l=s.ledger(),tip=s.commit("one"),run=join(s.directory,"original-run");
  mkdirSync(run);const summary=join(run,"summary.json");
  writeFileSync(summary,JSON.stringify({verdict:"green",identities:{commit:tip},requested:["tests","memory"]}));
  const id=l.prepare(s.base,tip,[entry(s.base,tip)],"strict",{commit:tip,run,checks:all});
  s.git("update-ref","refs/heads/main",tip,s.base);l.commit(id,tip);
  const batch=l.beginShadow(tip)!;
  writeFileSync(summary,JSON.stringify({requested:["new-step"]}));
  assert.deepEqual(batch.landings![0].steps,["tests","memory"]);
  const done=l.finishShadow(batch.id,{ok:false,run:"/shadow/all",stepVerdicts:{tests:"green",memory:"red","new-step":"green"}},tip);
  assert.equal(done.landings![0].agreement,"disagree");
});

test("a missing original full-train step list stays unavailable",t=>{
  const s=scratch(t),l=s.ledger(),tip=s.commit("one");
  const id=l.prepare(s.base,tip,[entry(s.base,tip)],"strict",proof(tip,all));
  s.git("update-ref","refs/heads/main",tip,s.base);l.commit(id,tip);
  const batch=l.beginShadow(tip)!,done=l.finishShadow(batch.id,{ok:true,run:"/shadow/missing",stepVerdicts:{tests:"green"}},tip);
  assert.equal(done.agreement,"unavailable");assert.equal(done.state,"held");
});

test("retired steps are named while shared steps still decide agreement",t=>{
  for (const red of [false,true]) {
    const s=scratch(t);let available:string[]|undefined;
    const l=new VerificationLedger(s.directory,s.repo,s.base,()=>tests,[],()=>available);
    const tip=s.commit("old train"),scope:Checks={steps:["tests","wasm"],interop:null};
    const id=l.prepare(s.base,tip,[entry(s.base,tip)],"strict",proof(tip,scope));
    s.git("update-ref","refs/heads/main",tip,s.base);l.commit(id,tip);
    const batch=l.beginShadow(tip)!,result={ok:!red,run:"/shadow/retired",stepVerdicts:{tests:red?"red" as const:"green" as const}};
    l.finishShadow(batch.id,result,tip);
    available=["tests"];
    const revised=l.recompareShadow(batch.id,result,tip);
    assert.deepEqual(revised.landings![0].retiredSince,["wasm"]);
    assert.deepEqual(revised.landings![0].steps,["tests","wasm"],"original scope is retained");
    assert.equal(revised.agreement,red?"disagree":"agree");
    assert.equal(revised.state,red?"held":"agreed");
    assert.equal(s.git("rev-parse","main"),tip);
    assert.ok(l.state.events.some(e=>e.transition==="shadow-recompared"));
    if (!red) {
      const next=s.commit("next"),n=l.prepare(tip,next,[entry(tip,next)],"strict",proof(next));
      s.git("update-ref","refs/heads/main",next,tip);l.commit(n,next);
      assert.equal(l.beginShadow(next)!.base,tip,"the next batch starts after the re-derived green one");
    }
  }
});

test("an observed red cannot be relabelled retired, and a missing live step stays unavailable",t=>{
  for (const observedRed of [false,true]) {
    const s=scratch(t),scope:Checks={steps:["tests","memory"],interop:null};
    const available=observedRed?["tests"]:["tests","memory"];
    const l=new VerificationLedger(s.directory,s.repo,s.base,()=>tests,[],()=>available);
    const tip=s.commit("change"),id=l.prepare(s.base,tip,[entry(s.base,tip)],"strict",proof(tip,scope));
    s.git("update-ref","refs/heads/main",tip,s.base);l.commit(id,tip);
    const batch=l.beginShadow(tip)!;
    const result={ok:!observedRed,run:"/shadow/live",stepVerdicts:{tests:"green" as const,...(observedRed?{memory:"red" as const}:{})}};
    const done=l.finishShadow(batch.id,result,tip);
    assert.deepEqual(done.landings![0].retiredSince,[]);
    assert.equal(done.agreement,observedRed?"disagree":"unavailable");
    assert.equal(done.state,"held");
  }
});

test("a legacy README docs move is reclassified by owed without hiding a real failure",t=>{
  for (const red of [false,true]) {
    const s=scratch(t),tree:Checks={steps:["format"],interop:null};
    const l=new VerificationLedger(s.directory,s.repo,s.base,()=>tree,["format"]);
    const tip=s.commit("proven"),id=l.prepare(s.base,tip,[entry(s.base,tip)],"strict",proof(tip));
    s.git("update-ref","refs/heads/main",tip,s.base);l.commit(id,tip);
    writeFileSync(join(s.repo,"README.md"),"documentation\n");s.git("add","README.md");s.git("commit","-qm","docs");
    const docs=s.git("rev-parse","HEAD");s.git("update-ref","refs/heads/main",docs,tip);
    const batch=l.beginShadow(docs)!;
    // A saved batch made by the old docs/ + AGENTS-only classifier.
    batch.landings![1].expectation="unknown";batch.expected="unknown";
    const result={ok:!red,run:"/shadow/readme",stepVerdicts:{tests:red?"red" as const:"green" as const,format:"green" as const}};
    l.finishShadow(batch.id,result,docs);
    const revised=l.recompareShadow(batch.id,result,docs);
    assert.deepEqual(revised.landings!.map(e=>e.agreement),[red?"disagree":"agree","no-expectation"]);
    assert.equal(revised.agreement,red?"disagree":"agree");
    assert.equal(revised.verdict,red?"red":"green","the raw verdict does not change");
    assert.throws(()=>l.recompareShadow(batch.id,{...result,ok:red},docs),/unavailable or changed/);
  }
});

test("README content owing a product check is not excluded as documentation",t=>{
  const s=scratch(t),l=new VerificationLedger(s.directory,s.repo,s.base,()=>tests,["format"]);
  const first=s.commit("proven"),id=l.prepare(s.base,first,[entry(s.base,first)],"strict",proof(first));
  s.git("update-ref","refs/heads/main",first,s.base);l.commit(id,first);
  writeFileSync(join(s.repo,"README.md"),"machine-read data\n");s.git("add","README.md");s.git("commit","-qm","readme input");
  const tip=s.git("rev-parse","HEAD");s.git("update-ref","refs/heads/main",tip,first);
  const batch=l.beginShadow(tip)!,done=l.finishShadow(batch.id,{ok:true,run:"/shadow/readme-input",stepVerdicts:{tests:"green"}},tip);
  assert.equal(done.landings![1].agreement,"unavailable");
  assert.equal(done.state,"held");
});

test("declared step identity requires clean tooling at the exact tip",t=>{
  const s=scratch(t),directory=join(s.repo,"tooling/gate"),file=join(directory,"run.mjs");mkdirSync(directory,{recursive:true});
  const source='process.stdout.write(JSON.stringify({tests:[]}));\n';writeFileSync(file,source);
  s.git("add","tooling");s.git("commit","-qm","declarations");const tip=s.git("rev-parse","HEAD");
  assert.deepEqual(declaredShadowSteps(s.repo,tip),["tests"]);
  writeFileSync(file,'process.stdout.write(JSON.stringify({memory:[]}));\n');
  assert.equal(declaredShadowSteps(s.repo,tip),undefined,"a dirty declaration is not retirement evidence");
  writeFileSync(file,source);
  assert.equal(declaredShadowSteps(s.repo,s.base),undefined,"another tip is not this batch's declaration");
});

test("a range owing only retired steps supplies no positive agreement",t=>{
  const s=scratch(t),scope:Checks={steps:["wasm"],interop:null};
  const l=new VerificationLedger(s.directory,s.repo,s.base,()=>scope,[],()=>["tests"]);
  const tip=s.commit("old wasm"),id=l.prepare(s.base,tip,[entry(s.base,tip,scope)],"strict",proof(tip,scope));
  s.git("update-ref","refs/heads/main",tip,s.base);l.commit(id,tip);
  assert.equal(l.beginShadow(tip),null);
  assert.equal(l.state.shadow!.batches.length,0);
});

test("a docs failure cannot advance the shadow cursor even when all proven landings agree",t=>{
  const s=scratch(t),tree:Checks={steps:["format"],interop:null},l=new VerificationLedger(s.directory,s.repo,s.base,()=>tree,["format"]);
  const first=s.commit("one"),id=l.prepare(s.base,first,[entry(s.base,first)],"strict",proof(first));
  s.git("update-ref","refs/heads/main",first,s.base);l.commit(id,first);
  mkdirSync(join(s.repo,"docs"));writeFileSync(join(s.repo,"docs/design.md"),"bad format\n");
  s.git("add","docs/design.md");s.git("commit","-qm","docs");const tip=s.git("rev-parse","HEAD");
  s.git("update-ref","refs/heads/main",tip,first);
  const batch=l.beginShadow(tip)!,done=l.finishShadow(batch.id,{ok:false,run:"/shadow/docs-red",stepVerdicts:{tests:"green",format:"red"}},tip);
  assert.equal(done.agreement,"agree");assert.equal(done.verdict,"red");assert.equal(l.state.verified.tip,first);
  assert.equal(l.beginShadow(tip)!.base,s.base,"unverified docs stay in the next shadow range");
});

test("step comparisons reject setup failures, interruptions and the wrong source",()=>{
  const tip="a".repeat(40),summary={verdict:"green",identities:{commit:tip},steps:[{name:"tests",verdict:"PASS"},{name:"on-device",verdict:"SKIPPED"}]};
  assert.deepEqual(shadowStepVerdicts(tip,true,summary,{status:0}),{tests:"green","on-device":"green"});
  assert.equal(shadowStepVerdicts(tip,false,summary,{status:17}),undefined);
  assert.equal(shadowStepVerdicts(tip,false,{...summary,verdict:"red",interrupted:"SIGINT"},{status:1}),undefined);
  assert.equal(shadowStepVerdicts("b".repeat(40),true,summary,{status:0}),undefined);
  assert.deepEqual(shadowStepVerdicts(tip,false,{...summary,verdict:"red",steps:[{name:"tests",verdict:"PASS"},{name:"memory",verdict:"FAIL"}]},{status:1}),{tests:"green",memory:"red"});
});

test("an older bootstrap snapshot keeps its unavailable agreement",t=>{
  const s=scratch(t),l=s.ledger(),tip=s.commit("one");
  const id=l.prepare(s.base,tip,[entry(s.base,tip)],"strict",proof(tip));
  s.git("update-ref","refs/heads/main",tip,s.base);l.commit(id,tip);
  const batch=l.beginShadow(tip)!;delete batch.landings;batch.expected="unknown";
  const done=l.finishShadow(batch.id,{ok:true,run:"/shadow/legacy"},tip);
  assert.equal(done.verdict,"green");assert.equal(done.agreement,"unavailable");assert.equal(done.state,"held");
});

test("a proven comparison cannot lose its original train proof",t=>{
  const s=scratch(t),l=s.ledger(),tip=s.commit("one");
  const id=l.prepare(s.base,tip,[entry(s.base,tip)],"strict",proof(tip));
  s.git("update-ref","refs/heads/main",tip,s.base);l.commit(id,tip);l.beginShadow(tip);
  const file=join(s.directory,"ledger.json"),saved=JSON.parse(readFileSync(file,"utf8"));
  delete saved.shadow.batches[0].landings[0].proof;
  writeFileSync(file,JSON.stringify(saved));assert.throws(()=>readLedger(s.directory),/invalid shadow landing/);
});

test("a shadow restart interrupts the old batch without certifying it",t=>{
  const s=scratch(t),l=s.ledger(),tip=s.commit("one"),id=l.prepare(s.base,tip,[entry(s.base,tip)],"strict",proof(tip));
  s.git("update-ref","refs/heads/main",tip,s.base);l.commit(id,tip);
  const interrupted=l.beginShadow(tip)!,restarted=s.ledger(),next=restarted.beginShadow(tip)!;
  assert.equal(restarted.state.shadow!.batches[0].state,"interrupted");
  assert.notEqual(next.id,interrupted.id);assert.equal(next.tip,tip);
  assert.throws(()=>restarted.finishShadow(interrupted.id,{ok:true,run:"/late"},tip),/not active/);
});
