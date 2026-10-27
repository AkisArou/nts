import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { auditTestTiming, timingProblems, timingSites } from "./test-timing.ts";
import { testProcessResult, waitFor } from "./test-wait.ts";

test("every tooling test has only its exact reviewed timing sites", () => {
  const result = auditTestTiming(fileURLToPath(new URL("../../", import.meta.url)));
  assert.deepEqual(result.problems, [], result.problems.join("\n"));
});

test("the lint rejects sleeps, aliased timers, clocks and short process deadlines", () => {
  const sources = [
    "await sleep(20); assert.equal(child.ready, true);",
    'import {setTimeout as delay} from "node:timers/promises"; await delay(10); assert.ok(ready);',
    "await new Promise(r => setTimeout(r, 10)); assert.ok(ready);",
    'spawnSync("node", ["-e", "setTimeout(() => {}, 10)"], {timeout: 12_000});',
    "const deadline=Date.now()+2000; while(Date.now()<deadline) {} assert.ok(ready);",
  ];
  for (const source of sources) assert.ok(timingProblems(timingSites("new.test.ts", source), []).length, source);
  assert.deepEqual(timingSites("new.test.ts", "// a sleep in a comment is documentation\nawait waitFor('ready',()=>ready); assert.ok(ready);"), []);
});

test("a reviewed site cannot bless a different file or an additional timer", () => {
  const source = "await sleep(10);";
  const reviewed = [{file:"one.test.ts",source,kind:"hang guard",reason:"fixture barrier",count:1}];
  assert.deepEqual(timingProblems(timingSites("one.test.ts",source), reviewed), []);
  assert.ok(timingProblems(timingSites("two.test.ts",source), reviewed).length);
  assert.ok(timingProblems(timingSites("one.test.ts",`${source}\n${source}`), reviewed).length);
  assert.ok(timingProblems([], reviewed).length, "a removed guard must also update its review");
});

test("a late real event crosses the former sleeps without deciding by elapsed time", async () => {
  const worker = spawn(process.execPath, ["-e", "setTimeout(()=>console.log('ready'),1200)"], {stdio:["ignore","pipe","pipe"]});
  let output="",closed=false;
  worker.stdout.on("data",chunk=>{output+=chunk;});
  const done=new Promise<number|null>(resolve=>worker.on("close",status=>{closed=true;resolve(status);}));
  try {
    await waitFor("the delayed real ready message",()=>output==="ready\n",{stopped:()=>closed?"worker closed without its row":undefined});
    assert.equal(await done,0);
    assert.equal(output,"ready\n");
  } finally {await done;}
});

test("a hung wait and an early child exit name the event that was not measured", async () => {
  await assert.rejects(waitFor("the stand-in ready message",()=>false,{timeoutMs:0}), /test hung waiting for the stand-in ready message/);
  await assert.rejects(waitFor("the stand-in ready message",()=>false,{stopped:()=>"child exited 7"}), /child exited 7/);
});

test("a process guard expiry is reported as hung rather than an ordinary child verdict", () => {
  const failed = spawnSync(process.execPath,["-e","process.exit(7)"],{encoding:"utf8"});
  assert.equal(testProcessResult(failed,"intentional failure").status,7);
  const error=Object.assign(new Error("spawnSync ETIMEDOUT"),{code:"ETIMEDOUT"});
  assert.throws(()=>testProcessResult({...failed,status:null,error},"a named fixture"),/test hung waiting for a named fixture/);
});
