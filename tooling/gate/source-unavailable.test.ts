import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import test from "node:test";
import {spawnTest} from "./test-wait.ts";

test("backend policy separates named unavailable populations from defects and partial coverage", t => {
  const root=mkdtempSync(join(tmpdir(),"nts-source-unavailable-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const name of ["control","calls"]){const dir=join(root,"tests/programs",name);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,"tsconfig.json"),"{}");}
  const diff=join(root,"tooling/differential");mkdirSync(diff,{recursive:true});
  writeFileSync(join(diff,"agree.mjs"),`import {copyFileSync} from 'node:fs';const out=process.argv.find(arg=>arg.startsWith('--verdicts=')).slice('--verdicts='.length);copyFileSync(process.env.SOURCE_VERDICTS,out);`);
  execFileSync("git",["init","--quiet"],{cwd:root});execFileSync("git",["add","."],{cwd:root});
  const source=readFileSync(new URL("./all.sh",import.meta.url),"utf8"),start=source.indexOf("backend_examples() {"),end=source.indexOf("\n}\n",start)+2;
  assert.ok(start>=0&&end>start,"the production backend policy is present");
  const script=join(root,"policy.sh"),rows=join(root,"verdicts.txt");
  writeFileSync(script,`#!/bin/sh\nset -eu\nroot=${JSON.stringify(root)}\njobs=1\ncd "$root"\n${source.slice(start,end)}\nbackend_examples 1 control exact 23\n`);
  const run=(lines:string[])=>{writeFileSync(rows,lines.join("\n")+"\n");return spawnTest("sh",[script],{cwd:root,encoding:"utf8",env:{...process.env,SOURCE_VERDICTS:rows,NTS_BIN:"/not-executed"}});};
  const accepted=run(["ok control","unavailable calls\t29 calls without compiled bindings; 29 Node calls measured"]);
  assert.equal(accepted.status,0,accepted.stdout+accepted.stderr);
  assert.match(accepted.stdout,/1 of 1 examples agree/);assert.match(accepted.stdout,/1 Node populations measured without compiled bindings/);
  for(const finding of ["wrong","abort","backend error"]){const changed=run(["ok control",`no calls\t${finding}`]);assert.notEqual(changed.status,0,changed.stdout+changed.stderr);assert.match(changed.stderr,/not allowed by name/);}
  const unknown=run(["ok control","unavailable unexpected\t29 unavailable calls"]);
  assert.notEqual(unknown.status,0);assert.match(unknown.stderr,/unrecorded unavailable source bindings: unexpected/);
  const held=run(["ok control","unmeasured calls\tbroken observer"]);
  assert.notEqual(held.status,0);assert.match(held.stdout,/could not be measured/);
  const partial=(count:number)=>Array.from({length:count},(_,at)=>`partial p${at}\t1 declined, 28 of 29 compared`);
  const within=run(partial(23));assert.equal(within.status,0,within.stdout+within.stderr);
  const exceeded=run(partial(24));assert.notEqual(exceeded.status,0);assert.match(exceeded.stderr,/24 example\(s\).*ceiling is 23/);
});
