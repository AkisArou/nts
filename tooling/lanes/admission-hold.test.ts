import{test}from"node:test";import assert from"node:assert/strict";
import{admitted,type HoldStatus}from"./admission-hold.ts";
test("resource holds preserve the operation and report their age until real recovery",()=>{
 let checks=0,now=0,recovered=-1;const states:HoldStatus[]=[];
 const value=admitted("selector",()=>++checks<4?{hold:"worktree creation unavailable"}:{value:42},s=>states.push(s),{now:()=>now,pause:()=>{now+=5000;},recovered:s=>{recovered=s;}});
 assert.equal(value,42);assert.equal(checks,4);assert.deepEqual(states.map(s=>s.age_s),[0,5,10]);assert.equal(recovered,15);
 assert.ok(states.every(s=>s.state==="held"&&s.resource==="selector"&&s.since==="1970-01-01T00:00:00.000Z"));
});
test("an actual policy exception is never converted to an admission grant",()=>{
 assert.throws(()=>admitted("selector",()=>{throw new Error("invalid rule policy");},()=>assert.fail("policy is not a machine hold")),/invalid rule policy/);
});
