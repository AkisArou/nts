import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { fixturePool, fixtureWorker } from "../conformance/blockers-pool.ts";
import { createTokenPool } from "./tokenpool.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const names = ["a-slow", "b-fast", "c-middle"];
function harness(t: { after: (fn: () => void) => void }, fixtureNames = names) {
  const root = mkdtempSync(join(tmpdir(), "nts-blockers-pool-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ["tooling/conformance", "tooling/gate", "napi", "tmp"]) mkdirSync(join(root, path), {recursive:true});
  for (const path of ["conformance/blockers-check.mjs", "conformance/blockers-child.mjs", "conformance/blockers-pool.ts", "gate/tokens.mjs"]) {
    copyFileSync(join(HERE, "..", path), join(root, "tooling", path));
  }
  writeFileSync(join(root, "napi/node_api.h"), "");
  const trace = join(root, "trace.jsonl");
  writeFileSync(trace, "");
  for (const name of fixtureNames) {
    const dir = join(root, "tests/refusals", name);
    mkdirSync(join(dir, "src"), {recursive:true});
    writeFileSync(join(dir, "tsconfig.json"), "{}");
    writeFileSync(join(dir, "src/main.ts"), "// expect: nothing refused\nexport function value() { return 1; }\n");
  }
  const compiler = join(root, "compiler");
  writeFileSync(compiler, `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const name = path.basename(path.dirname(process.argv.at(-1)));
const event = stage => fs.appendFileSync(process.env.TRACE, JSON.stringify({name,stage})+'\\n');
event('start');
if(name==='a-slow' && process.env.ORDER_BARRIER==='1') {
 const deadline=Date.now()+10000;
 while(!fs.existsSync(process.env.TRACE+'.fast-finished')) {
  if(Date.now()>deadline) throw new Error('the other admitted fixture did not finish');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
 }
}
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,{'a-slow':250,'b-fast':1,'c-middle':80}[name] ?? 1);
if(process.env.FAIL_FIXTURE===name){
 const deadline=Date.now()+10000;
 for(const other of (process.env.FAILURE_WAITS_FOR??'').split(',').filter(Boolean)) {
  while(!fs.existsSync(process.env.TRACE+'.'+other+'.finished')) {
   if(Date.now()>deadline) throw new Error('the preceding fixtures did not finish');
   Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
  }
 }
 console.error('original compiler failure');process.exit(7);
}
console.log(process.env.BAD_FIXTURE === name ? 'NTS1001 test refusal' : 'nothing refused');
event('end');
fs.writeFileSync(process.env.TRACE+'.'+name+'.finished','');
if(name==='b-fast') fs.writeFileSync(process.env.TRACE+'.fast-finished','');
`, {mode:0o755});
  const run = (jobs: number, extra = {}) => new Promise<{status:number|null;stdout:string;stderr:string}>((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, "tooling/conformance/blockers-check.mjs")], {
      cwd:root, env:{...process.env, NTS_COMPILER:compiler, NTS_GATE_JOBS:String(jobs), TMPDIR:join(root,"tmp"),
        NTS_NAPI_INCLUDE:join(root,"napi"), TRACE:trace, NTS_GATE_TOKENS:"", NTS_GATE_TOKEN_HELD:"", ...extra},
    });
    let stdout="",stderr="";
    child.stdout.setEncoding("utf8").on("data", s => { stdout+=s; });
    child.stderr.setEncoding("utf8").on("data", s => { stderr+=s; });
    child.on("error",reject);
    child.on("close",status => resolve({status,stdout,stderr}));
  });
  return {root,trace,run};
}

test("real fixture workers hold one token each, obey admission, and report in fixture order", async t => {
  const h=harness(t);
  let open=false;
  const observations: any[]=[];
  const pool=createTokenPool({free:()=>open ? 2-pool.total : 0,claim:()=>1,observe:(e: any)=>observations.push(e)});
  await pool.start();
  t.after(()=>pool.close());
  const ran=h.run(3,{ORDER_BARRIER:"1",NTS_GATE_TOKENS:pool.addr,NTS_GATE_STEP:"blockers",NTS_GATE_CASE_COSTS_DIR:join(h.root,"costs")});
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(readFileSync(h.trace,"utf8"),"", "no compiler before token admission");
  open=true; pool.grant();
  const result=await ran;
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.stderr,"");
  assert.equal(result.stdout,names.map(n=>`  guard ok    ${n}\n`).join("")+"\n  3 fixture(s), 3 as expected, 0 needing a person\n");
  const trace=readFileSync(h.trace,"utf8").trim().split("\n").map(s=>JSON.parse(s));
  assert.notEqual(trace.find(e=>e.stage==="end").name,"a-slow");
  const grants=observations.filter(e=>e.event==="token.grant");
  assert.equal(grants.length,3);
  assert.equal(pool.peak.get("blockers"),2);
  assert.deepEqual(grants.map(e=>JSON.parse(Buffer.from(e.context.slice(7),"base64url").toString()).project).sort(),
    names.map(n=>`tests/refusals/${n}/tsconfig.json`));
});

test("a changed expectation keeps the serial fixture messages, counts, and nonfatal verdict", async t => {
  const h=harness(t);
  const serial=await h.run(1,{BAD_FIXTURE:"b-fast"});
  const concurrent=await h.run(3,{BAD_FIXTURE:"b-fast"});
  assert.equal(serial.status,0,serial.stderr);
  assert.equal(concurrent.status,serial.status);
  // The old interpreter retains its random scratch root when a fixture changes.
  const stable=(s: string)=>s.replace(/^  kept .*\n/gm,"");
  assert.equal(stable(concurrent.stdout),stable(serial.stdout));
  assert.equal(concurrent.stderr,serial.stderr);
  assert.match(concurrent.stdout,/REGRESSED   b-fast/);
  assert.match(concurrent.stdout,/3 fixture\(s\), 2 as expected, 1 needing a person/);
  assert.equal(concurrent.stdout.match(/^  kept /gm)?.length,1);
});

test("a failed fixture stops feeding, drains admitted work, and cannot become a green result", async () => {
  const started: string[]=[];
  let drained=false;
  const reported: string[]=[];
  await assert.rejects(fixturePool(names,2,async name=>{
    started.push(name);
    if(name==="a-slow") throw new Error("original compiler failure");
    await new Promise(resolve=>setTimeout(resolve,20));
    drained=true;
    return {stdout:name,stderr:"",unexpected:0,retainRun:false};
  },result=>reported.push(result.stdout)),/original compiler failure/);
  assert.deepEqual(started,names.slice(0,2));
  assert.equal(drained,true);
  assert.deepEqual(reported,[],"no row after the failed first fixture is reported");
});

test("a complete in-order prefix is reported before the last fixture finishes", async () => {
  const ready=names.map(()=>Promise.withResolvers<void>());
  const reported: string[]=[];
  const running=fixturePool(names,3,async (_name,index)=>{
    await ready[index].promise;
    return {stdout:names[index],stderr:"",unexpected:0,retainRun:false};
  },result=>reported.push(result.stdout));
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  ready[1].resolve();await tick();assert.deepEqual(reported,[]);
  ready[0].resolve();await tick();assert.deepEqual(reported,names.slice(0,2));
  ready[2].resolve();await running;assert.deepEqual(reported,names);
});

test("the final integrity pass runs once and reacquires tokens after all fixture leases end", async t => {
  const h=harness(t);
  mkdirSync(join(h.root,"bin"));
  writeFileSync(join(h.root,"bin/git"),`#!${process.execPath}
if (process.argv.includes('status')) console.log('?? tests/refusals/a-slow/src/main.ts');
else process.stdout.write(${JSON.stringify(names.map(n=>`${n}/src/main.ts`).join("\0")+"\0")});
`,{mode:0o755});
  writeFileSync(join(h.root,"tooling/conformance/integrity.ts"),`
import {appendFileSync} from 'node:fs';
import {withToken} from '../gate/tokens.mjs';
await withToken(async()=>{appendFileSync(process.env.TRACE,JSON.stringify({stage:'integrity'})+'\\n');});
`);
  const observations: any[]=[];
  const pool=createTokenPool({free:()=>1-pool.total,claim:()=>1,observe:(e: any)=>observations.push(e)});
  await pool.start();t.after(()=>pool.close());
  const result=await h.run(3,{PATH:`${join(h.root,"bin")}:${process.env.PATH}`,
    NTS_GATE_TOKENS:pool.addr,NTS_GATE_STEP:"blockers",NTS_GATE_CASE_COSTS_DIR:join(h.root,"costs")});
  assert.equal(result.status,0,result.stderr);
  assert.equal(observations.filter(e=>e.event==="token.grant").length,4);
  const trace=readFileSync(h.trace,"utf8").trim().split("\n").map(s=>JSON.parse(s));
  assert.equal(trace.filter(e=>e.stage==="integrity").length,1);
  assert.equal(trace.at(-1).stage,"integrity");
  assert.match(result.stdout,/3 fixture\(s\), 3 as expected, 0 needing a person\n  integrity: clean over the 1 uncommitted fixture\(s\)\n$/);
});

test("fixtures queued for a token do not start after an admitted fixture fails", async t => {
  const h=harness(t);
  const pool=createTokenPool({free:()=>1-pool.total,claim:()=>1});
  await pool.start();t.after(()=>pool.close());
  const result=await h.run(3,{FAIL_FIXTURE:"a-slow",NTS_GATE_TOKENS:pool.addr,NTS_GATE_STEP:"blockers"});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/compiler child failed: status=7/);
  assert.doesNotMatch(result.stdout,/fixture\(s\), .* as expected/);
  const starts=readFileSync(h.trace,"utf8").trim().split("\n").map(s=>JSON.parse(s)).filter(e=>e.stage==="start");
  assert.deepEqual(starts.map(e=>e.name),["a-slow"]);
  const kept=readdirSync(join(h.root,"tmp")).find(n=>n.startsWith("nts-blockers-"))!;
  const record=JSON.parse(readFileSync(join(h.root,"tmp",kept,"child-a-slow-0.json"),"utf8"));
  assert.equal(record.status,7);
  assert.match(record.stderr,/original compiler failure/);
});

test("a cancelled token wait leaves a reporting gap even when later fixtures completed", async t => {
  const items=["a-first","b-second","c-gap","d-finished","e-failed"];
  const h=harness(t,items);
  let blocked: import("node:net").Socket | undefined, failureClosed=false;
  const server=createServer(socket=>{
    let text="",parsed=false;
    socket.setEncoding("utf8");
    socket.on("data",chunk=>{
      text+=chunk;
      if(parsed || !text.includes("\n")) return;
      parsed=true;
      const encoded=text.trim().split(" ")[3].slice(7);
      const context=JSON.parse(Buffer.from(encoded,"base64url").toString());
      const name=context.project.split("/").at(-2);
      if(name==="c-gap") { blocked=socket;if(failureClosed) socket.write("go\n"); }
      else socket.write("go\n");
      if(name==="e-failed") socket.on("close",()=>{
        failureClosed=true;
        blocked?.write("go\n");
      });
    });
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>{server.close();});
  const address=server.address() as import("node:net").AddressInfo;
  const result=await h.run(5,{FAIL_FIXTURE:"e-failed",FAILURE_WAITS_FOR:"a-first,b-second,d-finished",
    NTS_GATE_TOKENS:`127.0.0.1:${address.port}`,NTS_GATE_STEP:"blockers",NTS_GATE_CASE_COSTS_DIR:join(h.root,"costs")});
  assert.notEqual(result.status,0);
  assert.match(result.stdout,/^  guard ok    a-first\n  guard ok    b-second\n/);
  assert.doesNotMatch(result.stdout,/guard ok    d-finished|fixture\(s\),/);
  const trace=readFileSync(h.trace,"utf8").trim().split("\n").map(s=>JSON.parse(s));
  assert.ok(trace.some(e=>e.name==="d-finished" && e.stage==="end"));
  assert.ok(!trace.some(e=>e.name==="c-gap"),"the cancelled wait did not start compiler work");
});

test("missing worker accounting or a nonzero worker exit fails rather than fabricating fixture counts", async t => {
  const h=harness(t);
  const fake=join(h.root,"worker.mjs");
  writeFileSync(fake,"console.log('partial');\n");
  await assert.rejects(fixtureWorker(fake,"a",h.root),/JSON/);
  writeFileSync(fake,"console.error('original failure');process.exitCode=7;\n");
  await assert.rejects(fixtureWorker(fake,"a",h.root),/exited 7[\s\S]*original failure/);
});
