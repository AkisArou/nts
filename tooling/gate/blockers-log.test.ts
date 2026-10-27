import { waitFor } from "./test-wait.ts";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const HERE=dirname(fileURLToPath(import.meta.url));
function harness(t: {after:(fn:()=>void)=>void}) {
  const root=mkdtempSync(join(tmpdir(),"nts-blockers-log-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const dir of ["tooling/gate","bin","run","tmp"])mkdirSync(join(root,dir),{recursive:true});
  const shell=join(root,"tooling/gate/all.sh");
  copyFileSync(process.env.NTS_BLOCKERS_SHELL??join(HERE,"all.sh"),shell);
  writeFileSync(join(root,"bin/node"),`#!${process.execPath}
const fs=require('node:fs');
async function main(){
 if(process.argv[2]!=='tooling/conformance/blockers-check.mjs'){
  const r=require('node:child_process').spawnSync(process.execPath,process.argv.slice(2),{stdio:'inherit'});process.exitCode=r.status??1;return;
 }
 const text=fs.readFileSync(process.env.STUB_OUTPUT,'utf8');
 if(process.env.STUB_PAUSE==='1'){
  await new Promise(resolve=>setTimeout(resolve,2200));
  process.stdout.write('  guard ok    first\\n');
  const {waitFor}=await import(${JSON.stringify(new URL("./test-wait.ts",import.meta.url).href)});
  await waitFor('the blockers test release file',()=>fs.existsSync(process.env.STUB_RELEASE));
 }
 process.stdout.write(text);process.exitCode=Number(process.env.STUB_STATUS??0);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
`,{mode:0o755});
  const output=join(root,"output"),release=join(root,"release"),log=join(root,"run/blockers-fixtures.log");
  const run=(text: string,status=0,pause=false,runDirectory=true)=>{
    writeFileSync(output,text);
    const child=spawn("sh",[shell,"--call","blockers"],{cwd:root,
      env:{...process.env,PATH:`${join(root,"bin")}:${process.env.PATH}`,TMPDIR:join(root,"tmp"),
        NTS_GATE_RUN_DIR:runDirectory?join(root,"run"):"",STUB_OUTPUT:output,STUB_STATUS:String(status),STUB_RELEASE:release,STUB_PAUSE:pause?"1":"0"}});
    let stdout="",stderr="",closed=false;
    child.stdout.setEncoding("utf8").on("data",s=>{stdout+=s;});
    child.stderr.setEncoding("utf8").on("data",s=>{stderr+=s;});
    const done=new Promise<{status:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
      child.on("error",reject);child.on("close",status=>{closed=true;resolve({status,stdout,stderr});});
    });
    return {done,closed:()=>closed};
  };
  return {run,log,release};
}

test("fixture log grows before the interpreter completes",async t=>{
  const h=harness(t),suffix="  2 fixture(s), 2 as expected, 0 needing a person\n";
  const pending=h.run(suffix,0,true);
  try {
    await waitFor("the live blockers fixture log",()=>existsSync(h.log) && readFileSync(h.log,"utf8").includes("guard ok    first"),{
      stopped:()=>pending.closed()?"interpreter closed before writing progress":undefined,
    });
    assert.equal(pending.closed(),false,"interpreter must still be waiting");
  } finally {writeFileSync(h.release,"");await pending.done;}
  assert.equal(readFileSync(h.log,"utf8"),"  guard ok    first\n"+suffix);
});

test("a manual invocation names its unique retained fixture log",async t=>{
  const h=harness(t),text="  guard ok    first\n  1 fixture(s), 1 as expected, 0 needing a person\n";
  const result=await h.run(text,0,false,false).done;
  assert.equal(result.status,0,result.stderr);
  const named=/^  log: (.+)\n/.exec(result.stdout);
  assert.ok(named,"manual run must name the complete report");
  assert.equal(readFileSync(named[1],"utf8"),text);
  assert.equal(result.stdout.slice(named[0].length),text.split("\n").at(-2)+"\n");
});

const summary="  3 fixture(s), 2 as expected, 1 needing a person\n";
const scenarios=[
  {name:"healthy",text:"  guard ok    one\n"+summary,status:0,expected:summary,exit:0},
  {name:"fixed",text:"  FIXED       one: now works\n  detail\n"+summary,status:0,
    expected:summary+"  FIXED       one: now works\n  ^ convert these to guards; not a failure\n",exit:0},
  {name:"not evaluated",text:"  NO OUTPUT   one: no program\n  detail\n"+summary,status:0,
    expected:summary+"  NO OUTPUT   one: no program\n  detail\n  ^ emit-c wrote no program.c: these were not measured either way\n",exit:1},
  {name:"regression",text:"  REGRESSED   one: changed\n  detail one\n  detail two\n"+summary,status:0,
    expected:summary+"  REGRESSED   one: changed\n  detail one\n  detail two\n  ^ a fixture measuring something other than what it says\n",exit:1},
  {name:"failed child",text:Array.from({length:30},(_,i)=>`line ${i+1}\n`).join(""),status:7,
    expected:Array.from({length:25},(_,i)=>`line ${i+6}\n`).join("")+"  ^ blockers-check.mjs exited 7\n",exit:1},
];
for(const scenario of scenarios)test(`filtered messages and status: ${scenario.name}`,async t=>{
  const h=harness(t),result=await h.run(scenario.text,scenario.status).done;
  assert.equal(result.status,scenario.exit,result.stderr);
  assert.equal(result.stdout,scenario.expected);
  assert.equal(result.stderr,"");
});
