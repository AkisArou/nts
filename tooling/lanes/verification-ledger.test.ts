import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { covers, readLedger, VerificationLedger, type Checks } from "./verification-ledger.ts";

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
  const done=l.finishShadow(batch.id,{ok:true,run:"/shadow/one"},second);
  assert.equal(done.tip,first);assert.equal(done.agreement,"agree");
  const later=l.beginShadow(second)!;
  assert.equal(later.base,first);assert.equal(later.tip,second);assert.deepEqual(later.entries,[second]);
});

test("a red shadow batch holds without changing main or reverting anyone",t=>{
  const s=scratch(t),l=s.ledger(),tip=s.commit("one"),id=l.prepare(s.base,tip,[entry(s.base,tip)],"strict",proof(tip));
  s.git("update-ref","refs/heads/main",tip,s.base);l.commit(id,tip);
  const batch=l.beginShadow(tip)!,done=l.finishShadow(batch.id,{ok:false,run:"/shadow/red",message:"instrument failure"},tip);
  assert.equal(done.state,"held");assert.equal(done.agreement,"disagree");
  assert.equal(s.git("rev-parse","main"),tip);assert.equal(l.state.mode,"strict");
  assert.equal(l.state.shadow!.batches.filter(b=>b.state === "agreed").length,0);
});

test("a shadow restart interrupts the old batch without certifying it",t=>{
  const s=scratch(t),l=s.ledger(),tip=s.commit("one"),id=l.prepare(s.base,tip,[entry(s.base,tip)],"strict",proof(tip));
  s.git("update-ref","refs/heads/main",tip,s.base);l.commit(id,tip);
  const interrupted=l.beginShadow(tip)!,restarted=s.ledger(),next=restarted.beginShadow(tip)!;
  assert.equal(restarted.state.shadow!.batches[0].state,"interrupted");
  assert.notEqual(next.id,interrupted.id);assert.equal(next.tip,tip);
  assert.throws(()=>restarted.finishShadow(interrupted.id,{ok:true,run:"/late"},tip),/not active/);
});
