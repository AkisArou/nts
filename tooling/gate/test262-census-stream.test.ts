// The gate's census function streams a child still running, keeps its
// diagnostics and exit status, and checks every directory after a red one.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {newTestScratch} from "./test-scratch.ts";
import {waitFor} from "./test-wait.ts";

test("the census streams progress before a child completes and keeps a failure while checking the remaining records",async t=>{
  const root=newTestScratch("census-stream"),bin=join(root,"bin"),release=join(root,"release"),calls=join(root,"calls");
  mkdirSync(bin);mkdirSync(join(root,"third_party/test262/.git"),{recursive:true});
  const fn=readFileSync(new URL("./all.sh",import.meta.url),"utf8").match(/^test262_census\(\) \{\n[\s\S]*?^\}/m)?.[0];
  assert.ok(fn);
  writeFileSync(join(root,"census.sh"),`set -eu\njobs=24\n${fn}\ntest262_census c\n`);
  writeFileSync(join(bin,"node"),`#!/bin/sh
printf '%s\\n' "$5 $3 $9" >> ${JSON.stringify(calls)}
echo "  census start: $5; 1 case(s); $9 worker(s)"
if [ "$5" = test/language ];then
  echo '  500/1000 attempted (50.0/s)'
  exec ${JSON.stringify(process.execPath)} --input-type=module -e 'import {existsSync,watch} from "node:fs";const path=process.argv[1];if(!existsSync(path))await new Promise(resolve=>{const check=()=>{if(existsSync(path)){w.close();resolve();}};const w=watch(process.argv[2],check);check();});console.error("  REGRESSED: the fixture case changed");process.exit(1);' ${JSON.stringify(release)} ${JSON.stringify(root)}
fi
echo "  census complete: $5; 1/1 attempted; $9 worker(s); 0.1 s elapsed"
`,{mode:0o755});
  const child=spawn("sh",[join(root,"census.sh")],{cwd:root,env:{...process.env,PATH:`${bin}:${process.env.PATH}`},stdio:["ignore","pipe","pipe"]});
  let output="";child.stdout.on("data",b=>{output+=b;});child.stderr.on("data",b=>{output+=b;});
  const done=once(child,"close");
  t.after(async()=>{writeFileSync(release,"released");await done;rmSync(root,{recursive:true,force:true});});
  await waitFor("progress from the unfinished census",()=>output.includes("500/1000 attempted"),{stopped:()=>child.exitCode!==null?output:undefined});
  assert.equal(child.exitCode,null,"the progress arrived before the held child completed");
  writeFileSync(release,"released");
  assert.deepEqual(await done,[1,null],output);
  assert.match(output,/REGRESSED: the fixture case changed/);
  assert.match(output,/not held to their records on c: test\/language/);
  assert.deepEqual(readFileSync(calls,"utf8").trim().split("\n"),["test/language c 8","test/built-ins c 8","test/annexB c 8","test/staging c 8","test/harness c 8"]);
});

test("the census gives each directory's report a place in the run's folder, and a run by hand keeps none",async t=>{
  const root=newTestScratch("census-report-path"),bin=join(root,"bin"),calls=join(root,"calls");
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(bin);mkdirSync(join(root,"third_party/test262/.git"),{recursive:true});
  const fn=readFileSync(new URL("./all.sh",import.meta.url),"utf8").match(/^test262_census\(\) \{\n[\s\S]*?^\}/m)?.[0];
  assert.ok(fn);
  writeFileSync(join(root,"census.sh"),`set -eu\njobs=24\n${fn}\ntest262_census llvm\n`);
  // Each argument as it arrives, so a path with a space in it must come as one.
  writeFileSync(join(bin,"node"),`#!/bin/sh\nshift\nprintf '%s\\037' "$@" >> ${JSON.stringify(calls)}\nprintf '\\n' >> ${JSON.stringify(calls)}\n`,{mode:0o755});
  const run=async(env:NodeJS.ProcessEnv)=>{
    rmSync(calls,{force:true});
    const {NTS_GATE_RUN_DIR:_,...ambient}=process.env;
    const child=spawn("sh",[join(root,"census.sh")],{cwd:root,env:{...ambient,PATH:`${bin}:${process.env.PATH}`,...env},stdio:"ignore"});
    assert.deepEqual(await once(child,"close"),[0,null]);
    return readFileSync(calls,"utf8").trim().split("\n").map(line=>line.split("\x1f").slice(-3,-1).join(" "));
  };
  const folder=join(root,"run folder");
  assert.deepEqual(await run({NTS_GATE_RUN_DIR:folder}),["language","builtins","annexb","staging","harness"]
    .map(slice=>`--report ${folder}/test262-census/llvm/${slice}.json`));
  assert.deepEqual((await run({})).map(args=>args.split(" ")[0]),["--jobs","--jobs","--jobs","--jobs","--jobs"]);
});
