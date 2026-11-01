import {test} from "node:test";
import assert from "node:assert/strict";
import {mergeGateRetry} from "./gate-retry.ts";
import type {Attempt} from "./instrument-retry.ts";
const attempt=(run:string,rows:{name:string;verdict:string}[]):Attempt=>({run,status:0,summary:{requested:rows.map(row=>row.name),steps:rows,identities:{commit:"frozen",nts:{sha256:"compiler"}},environment:{canonical:true,host:{PATH:"tools"},ambient:{TZ:"UTC"}}}});
test("a held-step measurement keeps all 39 completed rows and fresh retry provenance",()=>{
  const completed=Array.from({length:39},(_,i)=>({name:`done-${i}`,verdict:"PASS"}));
  const prior=attempt("old",[...completed,{name:"c",verdict:"FAIL"},{name:"llvm",verdict:"FAIL"}]);
  const next=attempt("new",[{name:"c",verdict:"PASS"},{name:"llvm",verdict:"PASS"}]);
  const joined=mergeGateRetry(prior,next,["c","llvm"]);
  assert.equal(joined.summary.verdict,"green");assert.equal(joined.summary.steps.length,41);
  assert.deepEqual(joined.summary.steps.slice(0,39).map(row=>row.evidence_run),Array(39).fill("old"));
  assert.deepEqual(joined.summary.steps.slice(39).map(row=>row.evidence_run),["new","new"]);
  assert.equal(prior.summary.steps[39].verdict,"FAIL","the original evidence is immutable");
  const changes:((value:Attempt)=>unknown)[]=[value=>value.summary.identities.commit="other",value=>value.summary.identities.nts.sha256="other",value=>value.summary.environment.host.PATH="other",value=>value.summary.steps.pop()];
  for(const change of changes) {
    const bad=structuredClone(next);change(bad);assert.throws(()=>mergeGateRetry(prior,bad,["c","llvm"]),/frozen/);
  }
});
