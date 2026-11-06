import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createServer, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { selectRange, selectionInfrastructure, unionViews, type RuleView } from "./owed-range.ts";
import {committedChanges} from "./change-paths.ts";
import {waitFor} from "./test-wait.ts";
import {dependencyCache} from "../lanes/dependency-inputs.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
function fixtureRepository(t,repo:string,env:NodeJS.ProcessEnv):void {
  execFileSync("git",["clone","--quiet","--shared","--no-checkout",ROOT,repo],{env,stdio:["ignore","pipe","pipe"]});
  const git=(cwd:string,...args:string[])=>execFileSync("git",args,{cwd,env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  git(repo,"checkout","--quiet","--detach",git(ROOT,"rev-parse","HEAD"));
  // These fixtures change only policy/data, so use the same acquired registry
  // bytes as the source. Installed endpoint trees still belong to each range.
  const shared=dirname(git(ROOT,"rev-parse","--path-format=absolute","--git-common-dir"));
  const cache=dependencyCache(repo);assert.equal(existsSync(cache),false);
  mkdirSync(dirname(cache),{recursive:true});symlinkSync(dependencyCache(shared),cache,"dir");
  t.after(()=>rmSync(cache,{force:true}));
}
test("committed paths preserve spaces, Unicode, tabs and line breaks across a rename",t=>{
  const repo=mkdtempSync(join(tmpdir(),"owed-paths-"));t.after(()=>rmSync(repo,{recursive:true,force:true}));
  const env={...process.env,GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t"};
  const git=(...args:string[])=>execFileSync("git",args,{cwd:repo,env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  const before="before space Ɤ\tline\nbreak.ts",after="after space Ɤ\tline\nbreak.ts";
  git("init","-qb","main");writeFileSync(join(repo,before),"export const n=1;\n");git("add","--",before);git("commit","-qm","before");
  const base=git("rev-parse","HEAD");git("mv","--",before,after);git("commit","-qm","rename");
  assert.deepEqual(committedChanges(repo,base,"HEAD"),[{path:before,added:false,deleted:true},{path:after,added:true,deleted:false}]);
});
const view = (steps: string[] | "all", interop: string | null, doctests: string | null, catalogue = ["build", "interop", "doctests"]): RuleView =>
  ({ revision: "0".repeat(40), checks: { steps, interop, doctests }, catalogue, strict: false, rules: [] });

test("scope union keeps both project/crate subsets and either whole-step obligation", () => {
  const a = view(["interop", "doctests"], "alpha", "nts-core");
  const b = view(["interop", "doctests"], "beta", "nts-cli");
  for (const pair of [[a, b], [b, a]]) {
    const got = unionViews(pair);
    assert.deepEqual(new Set(got.interop!.split(" ")), new Set(["alpha", "beta"]));
    assert.deepEqual(new Set(got.doctests!.split(" ")), new Set(["nts-core", "nts-cli"]));
  }
  for (const pair of [[a, view(["interop", "doctests"], null, null)], [view(["interop", "doctests"], null, null), a]]) {
    assert.equal(unionViews(pair).interop, null);
    assert.equal(unionViews(pair).doctests, null);
  }
});

test("a removed step remains an obligation without a declared successor", () => {
  assert.throws(() => unionViews([view("all", null, null, ["build", "retired"]), view("all", null, null, ["build"])]),
    /step retired is owed by main's rules and removed by this change with no declared successor/);
});

test("the tip's declared split carries every base obligation to its current steps", () => {
  const base = view(["typescript-cases"], null, null, ["typescript-cases"]);
  const tip = { ...view([], null, null, ["typescript-c", "typescript-llvm", "typescript-jvm"]),
    successors: { "typescript-cases": { steps: ["typescript-c", "typescript-llvm", "typescript-jvm"] } } };
  assert.deepEqual(unionViews([base, tip]).steps, ["typescript-c", "typescript-llvm", "typescript-jvm"]);
  assert.equal(unionViews([{ ...base, checks: { ...base.checks, steps: "all" } }, tip]).steps, "all");
  assert.throws(() => unionViews([{ ...base, successors: tip.successors }, { ...tip, successors: undefined }]),
    /no declared successor/, "the base cannot authorize a tip's removal");
});

test("an explicit retirement needs a reason and invalid successor targets are refused", () => {
  const base = view(["retired"], null, null, ["retired"]);
  const tip = view(["build"], null, null, ["build"]);
  assert.deepEqual(unionViews([base, { ...tip, successors: { retired: { steps: [], reason: "covered outside this gate" } } }]).steps, ["build"]);
  for (const successors of [{ retired: { steps: [] } }, { retired: { steps: ["missing"] } }, { build: { steps: ["build"] } }]) {
    assert.throws(() => unionViews([base, { ...tip, successors }]), /successor|retirement/);
  }
});

test("a successor's project or crate scope is whole even beside narrower current selection", () => {
  const base = view(["old"], "unrelated", "unrelated", ["old"]);
  const tip = { ...view(["interop", "doctests"], "selected", "selected"),
    successors: { old: { steps: ["interop", "doctests"] } } };
  const got = unionViews([base, tip]);
  assert.equal(got.interop, null);
  assert.equal(got.doctests, null);
});

test("immutable endpoint selection carries the tip's successor table and rejects undeclared deletion", t => {
  const repo = mkdtempSync(join(tmpdir(), "owed-successors-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const file = join(repo, "tooling/gate/owed.mjs");
  mkdirSync(dirname(file), { recursive: true });
  const policy = (steps: string[], successors?: unknown) => `
export const allSteps=()=>${JSON.stringify(steps)};
export const selfTest=()=>null;
export const owed=()=>[{name:'control',paths:[],steps:allSteps(),arms:[]}];
export const gateSteps=rules=>rules.flatMap(rule=>rule.steps);
${successors === undefined ? "" : `export const STEP_SUCCESSORS=${JSON.stringify(successors)};`}\n`;
  writeFileSync(file, policy(["typescript-cases"]));
  git("init", "-qb", "main"); git("add", "."); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD"), steps = ["typescript-c", "typescript-llvm", "typescript-jvm"];
  const successors = { "typescript-cases": { steps } };
  writeFileSync(file, policy(steps, successors)); git("add", "."); git("commit", "-qm", "split");
  const split = selectRange(repo, `${base}..HEAD`);
  assert.deepEqual(split.checks.steps, steps);
  assert.deepEqual(split.views[1].successors, successors);
  writeFileSync(file, policy(steps)); git("add", "."); git("commit", "-qm", "undeclared removal");
  assert.throws(() => selectRange(repo, `${base}..HEAD`), /step typescript-cases is owed by main's rules and removed by this change with no declared successor/);
});

test("historical rules receive the same committed changes without modern metadata exports", t => {
  const repo=mkdtempSync(join(tmpdir(),"owed-legacy-"));
  t.after(()=>rmSync(repo,{recursive:true,force:true}));
  mkdirSync(join(repo,"tooling/gate"),{recursive:true});
  const env={...process.env,GIT_AUTHOR_NAME:"test",GIT_AUTHOR_EMAIL:"test@example.invalid",GIT_COMMITTER_NAME:"test",GIT_COMMITTER_EMAIL:"test@example.invalid"};
  const git=(...args:string[])=>execFileSync("git",args,{cwd:repo,env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  const code=`export const owed=changes=>[{name:"legacy",paths:changes.map(c=>c.path),steps:changes.length?["tests"]:[],arms:[]}];
export const gateSteps=rules=>rules.flatMap(r=>r.steps);
export const allSteps=()=>["tests","tooling"];
if(process.argv.includes("--self-test"))console.log("legacy self-test passed");\n`;
  const file=join(repo,"tooling/gate/owed.mjs");
  writeFileSync(file,code);git("init","-qb","main");git("add",".");git("commit","-qm","legacy base");
  const base=git("rev-parse","HEAD");
  writeFileSync(file,code.replace('?["tests"]','?["tooling"]'));
  git("add",".");git("commit","-qm","legacy candidate");
  const got=selectRange(repo,`${base}..HEAD`);
  assert.deepEqual(got.checks.steps,["tests","tooling"]);
  assert.equal(got.strict,true,"unknown historical routing stays strict");
});

test("range registries are private, borrow pinned objects, and disappear after success or failure",t=>{
  const directory=mkdtempSync(join(tmpdir(),"owed-private-registry-")),repo=join(directory,"repo"),report=join(directory,"report.jsonl");
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const env={...process.env,GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t"};
  mkdirSync(join(repo,"tooling/gate"),{recursive:true});
  const git=(...args:string[])=>execFileSync("git",args,{cwd:repo,env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  const policy=`import {execFileSync} from 'node:child_process';
import {appendFileSync,readFileSync} from 'node:fs';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const common=git('rev-parse','--path-format=absolute','--git-common-dir');
appendFileSync(${JSON.stringify(report)},JSON.stringify({common,revision:git('rev-parse','HEAD'),objects:git('count-objects','-v'),pins:execFileSync('git',['-C',${JSON.stringify(repo)},'for-each-ref','--format=%(refname) %(objectname)','refs/nts-selector/'],{encoding:'utf8'})})+'\\n');
export const selfTest=()=>readFileSync('mode','utf8')==='fail'?'intentional policy failure':null;
export const owed=()=>[{name:'control',paths:[],steps:['tooling'],arms:[]}];
export const gateSteps=rules=>rules.flatMap(rule=>rule.steps);
export const allSteps=()=>['tooling'];\n`;
  writeFileSync(join(repo,"tooling/gate/owed.mjs"),policy);writeFileSync(join(repo,"mode"),"healthy");
  git("init","-qb","main");git("add",".");git("commit","-qm","base");const base=git("rev-parse","HEAD");
  writeFileSync(join(repo,"candidate"),"candidate\n");git("add","candidate");git("commit","-qm","candidate");
  const healthy=git("rev-parse","HEAD");
  writeFileSync(join(repo,"mode"),"fail");git("add","mode");git("commit","-qm","policy failure");
  const failed=git("rev-parse","HEAD");
  assert.deepEqual(selectRange(repo,`${base}..${healthy}`).checks.steps,["tooling"],"healthy source control");
  writeFileSync(report,"");
  const boot=readFileSync("/proc/sys/kernel/random/boot_id","utf8").trim().replaceAll("-","");
  const stat=readFileSync(`/proc/${process.pid}/stat`,"utf8"),start=stat.slice(stat.lastIndexOf(")")+2).split(" ")[19];
  const stale=`refs/nts-selector/${process.pid}-0-${boot}-expired/base`,live=`refs/nts-selector/${process.pid}-${start}-${boot}-control/base`;
  git("update-ref",stale,base);git("update-ref",live,base);
  // A different process may have created gitdir before commondir. Keep that
  // exact intermediate registry entry present for the whole selection.
  const incomplete=join(repo,".git/worktrees/half-written");mkdirSync(incomplete,{recursive:true});
  writeFileSync(join(incomplete,"gitdir"),join(directory,"other/.git")+"\n");
  const marker=readFileSync(join(incomplete,"gitdir"),"utf8");
  assert.deepEqual(selectRange(repo,`${base}..${healthy}`).checks.steps,["tooling"]);
  assert.throws(()=>selectRange(repo,`${base}..${failed}`),/intentional policy failure/);
  const rows=readFileSync(report,"utf8").trim().split("\n").map(line=>JSON.parse(line));
  assert.equal(rows.length,4,"both endpoint imports on success and policy failure");
  for(const row of rows){
    assert.notEqual(row.common,join(repo,".git"));
    assert.match(row.objects,/^count: 0$/m);assert.match(row.objects,/^in-pack: 0$/m);
    assert.ok(row.pins.split("\n").some(line=>line.endsWith(` ${row.revision}`)),"borrowed revision has a live source pin");
    assert.equal(row.pins.includes(stale),false,"reused PID does not preserve an abandoned pin");
    assert.ok(row.pins.includes(live),"another live owner's pin is retained");
    assert.equal(existsSync(dirname(row.common)),false,"owned range and private registry cleaned");
  }
  assert.equal(git("for-each-ref","--format=%(refname)","refs/nts-selector/"),live,"only the other live owner's pin remains");
  git("update-ref","-d",live);
  assert.equal(readFileSync(join(incomplete,"gitdir"),"utf8"),marker,"source's in-progress entry left intact");
  assert.equal(existsSync(join(incomplete,"commondir")),false);
});

test("concurrent range preflights collect the same stale pin and only their own trees", async t => {
  const directory=mkdtempSync(join(tmpdir(),"owed-concurrent-")),repo=join(directory,"repo");
  const sockets=new Set<Socket>(),seen:string[]=[];
  let pair:Socket[]=[],collections:Socket[]=[],aborted=false;
  const server=createServer(socket=>{
    sockets.add(socket);socket.on("close",()=>sockets.delete(socket));
    let input="";
    socket.on("data",bytes=>{
      input+=bytes;
      if(!input.endsWith("\n"))return;
      const message=JSON.parse(input);
      if(message?.collection){
        collections.push(socket);
        if(collections.length===2){for(const waiting of collections)waiting.end("release\n");collections=[];}
        return;
      }
      seen.push(message);pair.push(socket);
      // Both real endpoint imports must be live before either may proceed.
      if(pair.length===2||aborted){for(const waiting of pair)waiting.end("release\n");pair=[];}
    });
  });
  const children:ReturnType<typeof spawn>[]=[];
  t.after(async()=>{
    for(const socket of sockets)socket.destroy();
    for(const child of children)if(child.exitCode===null)child.kill();
    await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():new Promise<void>(done=>child.once("close",()=>done()))));
    await new Promise<void>(done=>server.close(()=>done()));
    rmSync(directory,{recursive:true,force:true});
  });
  await new Promise<void>((done,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>done());});
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const env={...process.env,HOME:join(directory,"home"),OWED_TEST_BARRIER_PORT:String(address.port),GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t"};
  mkdirSync(join(repo,"tooling/gate"),{recursive:true});
  writeFileSync(join(repo,"tooling/gate/owed.mjs"),`
import {createConnection} from "node:net";
await new Promise((done,reject)=>{
 const socket=createConnection({host:"127.0.0.1",port:Number(process.env.OWED_TEST_BARRIER_PORT)});
 socket.once("error",reject);socket.once("connect",()=>socket.write(JSON.stringify(process.cwd())+"\\n"));
 socket.once("data",()=>socket.end());socket.once("close",done);
});
export const selfTest=()=>null;
export const owed=()=>[{name:"control",paths:[],steps:["tooling"],arms:[]}];
export const gateSteps=rules=>rules.flatMap(rule=>rule.steps);
export const allSteps=()=>["tooling"];
`);
  const git=(...args:string[])=>execFileSync("git",args,{cwd:repo,env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  git("init","-qb","main");git("add",".");git("commit","-qm","base");const base=git("rev-parse","HEAD");
  writeFileSync(join(repo,"candidate"),"candidate\n");git("add","candidate");git("commit","-qm","candidate");
  const boot=readFileSync("/proc/sys/kernel/random/boot_id","utf8").trim().replaceAll("-","");
  const stale=`refs/nts-selector/${process.pid}-0-${boot}-concurrent/base`;
  git("update-ref",stale,base);
  const actual=execFileSync("sh",["-c","command -v git"],{encoding:"utf8"}).trim(),bin=join(directory,"bin"),deletions=join(directory,"deletions.jsonl");mkdirSync(bin);
  writeFileSync(join(bin,"git"),`#!${process.execPath}
import {spawnSync} from 'node:child_process';import {appendFileSync} from 'node:fs';import {createConnection} from 'node:net';
const args=process.argv.slice(2),result=spawnSync(${JSON.stringify(actual)},args,{encoding:'utf8'});
if(process.env.OWED_TEST_COLLECT==='1'&&args[0]==='for-each-ref'&&args.at(-1)==='refs/nts-selector/')await new Promise((done,reject)=>{
 const socket=createConnection({host:'127.0.0.1',port:Number(process.env.OWED_TEST_BARRIER_PORT)});
 socket.once('error',reject);socket.once('connect',()=>socket.write(JSON.stringify({collection:true})+'\\n'));socket.once('data',()=>socket.end());socket.once('close',done);
});
if(args[0]==='update-ref'&&args[1]==='-d'&&args[2]===${JSON.stringify(stale)})appendFileSync(${JSON.stringify(deletions)},JSON.stringify({args,status:result.status})+'\\n');
process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');process.exitCode=result.status??1;
`);chmodSync(join(bin,"git"),0o755);env.PATH=`${bin}:${env.PATH}`;
  const script=`import {selectRange} from ${JSON.stringify(new URL("./owed-range.ts",import.meta.url).href)};console.log(JSON.stringify(selectRange(process.argv[1],process.argv[2]).checks));`;
  const run=()=>{
    const child=spawn(process.execPath,["--input-type=module","-e",script,repo,`${base}..HEAD`],{env:{...env,OWED_TEST_COLLECT:"1"},stdio:["ignore","pipe","pipe"]});children.push(child);
    let out="",err="";child.stdout!.on("data",bytes=>out+=bytes);child.stderr!.on("data",bytes=>err+=bytes);
    return new Promise<{code:number|null,out:string,err:string}>((done,reject)=>{
      child.once("error",reject);child.once("close",code=>{
        if(code!==0){aborted=true;for(const socket of sockets)socket.end("release\n");pair=[];}
        done({code,out,err});
      });
    });
  };
  const results:Awaited<ReturnType<typeof run>>[]=[];
  const pending=[run(),run()].map(result=>result.then(value=>{results.push(value);}));
  await waitFor("both concurrent selector preflights to finish",()=>results.length===2);
  await Promise.all(pending);
  for(const result of results){assert.equal(result.code,0,result.err);assert.deepEqual(JSON.parse(result.out).steps,["tooling"]);}
  assert.equal(seen.length,4,"both selectors evaluate both real endpoint trees");
  assert.equal(new Set(seen.map(path=>basename(path))).size,4,`shared registry basenames: ${JSON.stringify(seen)}`);
  const removed=readFileSync(deletions,"utf8").trim().split("\n").map(line=>JSON.parse(line));
  assert.equal(removed.length,2,"both selectors collected the same enumerated ref");
  assert.ok(removed.every(row=>row.args[3]===base),"both deletions compare the enumerated old value");
  assert.equal(removed.filter(row=>row.status!==0).length,1,"one compare-and-delete observes the already removed ref");
  assert.equal(git("for-each-ref","--format=%(refname)","refs/nts-selector/"),"");
  assert.equal(git("worktree","list","--porcelain").split("\n").filter(line=>line.startsWith("worktree ")).length,1,"neither preflight leaves a registered endpoint");
});

test("a rule cannot narrow its own committed range and dirty policy cannot alter it", async t => {
  const directory = mkdtempSync(join(tmpdir(), "owed-range-test-"));
  const repo = join(directory, basename(directory)+"-repo");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_") && !/GIT_(AUTHOR|COMMITTER)_/.test(key)) delete env[key];
  const git = (...args: string[]) => execFileSync("git", ["-c","core.hooksPath=/dev/null",...args], { cwd: repo, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  fixtureRepository(t,repo,env);
  const base = git("rev-parse", "HEAD");
  const policy = join(repo, "tooling/gate/owed.mjs");
  const original = readFileSync(policy, "utf8");
  assert.ok(original.includes("export const RULES = ["));
  writeFileSync(policy, original.replace("export const RULES = [", `export const RULES = [
    {name:"the newly classified path",when:p=>p==="new-area/control.dat",steps:["tooling"],arms:[]},`)
    .replace(/export const isStrictPath = [^\n]+/, "export const isStrictPath = () => false;"));
  mkdirSync(join(repo, "new-area"));
  writeFileSync(join(repo, "new-area/control.dat"), "new compiled input\n");
  git("add", "tooling/gate/owed.mjs", "new-area/control.dat");
  git("commit", "-qm", "classify a previously unmatched path");
  const tip = git("rev-parse", "HEAD");
  const selected = selectRange(repo, `${base}..${tip}`);
  const expanded = (v: RuleView) => v.checks.steps === "all" ? v.catalogue : v.checks.steps;
  const oldOnly = expanded(selected.views[0]).filter(s => !expanded(selected.views[1]).includes(s));
  assert.ok(oldOnly.length > 0, "the candidate-only control must really narrow the old obligations");
  const joined = selected.checks.steps === "all" ? selected.views[1].catalogue : selected.checks.steps;
  for (const step of oldOnly) assert.ok(joined.includes(step), `base rule still owes ${step}`);
  assert.equal(selected.views[1].strict, false);
  assert.equal(selected.strict, true, "removing the strict classifier cannot make its own edit optimistic");
  // A later working-tree edit is outside both selected commits.
  writeFileSync(policy, "throw new Error('dirty policy must not run');\n");
  assert.deepEqual(selectRange(repo, `${base}..${tip}`).checks, selected.checks);
  assert.equal(git("rev-parse", "HEAD"), tip);
  const worktrees = git("worktree", "list", "--porcelain");
  assert.equal(worktrees.split("\n").filter(l => l.startsWith(`worktree ${directory}/`)).length, 1, "only the fixture's own primary tree remains registered");
  const committed = git("show", `${tip}:tooling/gate/owed.mjs`);
  assert.ok(committed.includes("export function selfTest() {"));
  writeFileSync(policy, committed.replace("export function selfTest() {", 'export function selfTest() { return "broken rule control"; }\nfunction unusedOriginalSelfTest() {'));
  git("add", "tooling/gate/owed.mjs");
  git("commit", "-qm", "break the rule self-check");
  assert.throws(() => selectRange(repo, `${tip}..HEAD`), /broken rule control/);
});

test("a failed range worktree creation is identified as infrastructure",t=>{
 const repo=mkdtempSync(join(tmpdir(),"range-machine-"));t.after(()=>rmSync(repo,{recursive:true,force:true}));
 const env={...process.env,GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t"};
 const git=(...args:string[])=>execFileSync("git",args,{cwd:repo,env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
 git("init","-qb","main");writeFileSync(join(repo,"base"),"base");git("add","base");git("commit","-qm","base");const base=git("rev-parse","HEAD");
 writeFileSync(join(repo,"next"),"next");git("add","next");git("commit","-qm","next");
 const actual=execFileSync("sh",["-c","command -v git"],{encoding:"utf8"}).trim(),bin=join(repo,"bin"),attempt=join(repo,"attempt");mkdirSync(bin);
 const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
 writeFileSync(join(bin,"git"),`#!/bin/sh\nif [ "$1" = worktree ] && [ "$2" = add ]; then pwd > ${quote(attempt)}; echo 'resource unavailable' >&2; exit 75; fi\nexec ${quote(actual)} "$@"\n`);chmodSync(join(bin,"git"),0o755);
 const prior=process.env.PATH;t.after(()=>{process.env.PATH=prior;});process.env.PATH=`${bin}:${prior}`;
 assert.throws(()=>selectRange(repo,`${base}..HEAD`),error=>selectionInfrastructure(error)&&String(error).includes("resource unavailable"));
 const registry=readFileSync(attempt,"utf8").trim();assert.equal(basename(registry),"registry.git");
 assert.equal(existsSync(dirname(registry)),false,"failed creation removes its private range directory");
 assert.equal(git("for-each-ref","--format=%(refname)","refs/nts-selector/"),"","failed creation removes its pins");
});

test("Cargo infrastructure crosses the endpoint process without becoming a policy refusal", t => {
  const repo = mkdtempSync(join(tmpdir(), "range-cargo-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const gate = join(repo, "tooling/gate");
  mkdirSync(gate, { recursive: true });
  for (const file of ["owed-range.ts", "checks.ts", "change-paths.ts"]) writeFileSync(join(gate, file), readFileSync(join(ROOT, "tooling/gate", file)));
  writeFileSync(join(repo, "Cargo.toml"), "[workspace]\n");
  writeFileSync(join(gate, "owed.mjs"), `
import {readFileSync} from "node:fs";
import {SelectionInfrastructureError} from "./owed-range.ts";
const mode=readFileSync(new URL("../../mode",import.meta.url),"utf8");
export function crates(){
 if(mode==="typed")throw new SelectionInfrastructureError("cargo metadata --no-deps --offline: metadata control stderr");
 return mode==="legacy"?null:new Map();
}
export const selfTest=()=>mode==="legacy"||mode==="policy"?"broken policy control":null;
export const owed=()=>[{name:"control",paths:[],steps:["tooling"],arms:[]}];
export const gateSteps=rules=>rules.flatMap(r=>r.steps);
export const allSteps=()=>["tooling"];
`);
  writeFileSync(join(repo, "mode"), "healthy");
  git("init", "-qb", "main"); git("add", "."); git("commit", "-qm", "healthy metadata");
  const base = git("rev-parse", "HEAD");
  for (const mode of ["typed", "legacy", "policy", "healthy"]) {
    writeFileSync(join(repo, "mode"), mode);
    git("add", "mode"); git("commit", "-qm", mode);
    if (mode === "healthy") {
      assert.deepEqual(selectRange(repo, `${base}..HEAD`).checks.steps, ["tooling"]);
    } else {
      assert.throws(() => selectRange(repo, `${base}..HEAD`), error => {
        assert.equal(selectionInfrastructure(error), mode !== "policy", String(error));
        assert.match(String(error), mode === "typed" ? /metadata control stderr/ : mode === "legacy" ? /Cargo metadata is unavailable/ : /broken policy control/);
        return true;
      });
    }
  }
});

function newPathFixture(t) {
  const repo=mkdtempSync(join(tmpdir(),"owed-new-path-"));t.after(()=>rmSync(repo,{recursive:true,force:true}));
  const env={...process.env,GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t"};
  const git=(...args:string[])=>execFileSync("git",args,{cwd:repo,env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  const write=(path:string,text:string)=>{mkdirSync(join(repo,path,".."),{recursive:true});writeFileSync(join(repo,path),text);};
  write("tooling/gate/all.sh","node tooling/conformance/named-new.ts\n");
  write("tooling/gate/rules.json","{\"version\":1}\n");
  write("tooling/gate/policy.ts","export const leafStep='tooling';\n");
  const policy=`import {existsSync,readFileSync} from 'node:fs';
import {leafStep} from './policy.ts';
export const SELECTOR_POLICY_DATA=['tooling/gate/all.sh','tooling/gate/rules.json'];
export const allSteps=()=>['build','tests','tooling','profile','full'];
export const selfTest=()=>null;
export const isStrictPath=()=>true;
export function owed(changes){
 JSON.parse(readFileSync('tooling/gate/rules.json','utf8'));
 const script=readFileSync('tooling/gate/all.sh','utf8');
 return [{name:'always',paths:[],steps:['tests'],arms:[]},...changes.map(c=>({name:c.path,paths:[c.path],steps:existsSync(c.path)?[script.includes(c.path)?'profile':leafStep]:[],full:!existsSync(c.path),arms:[]}))];
}
export const gateSteps=rules=>rules.some(row=>row.full)?allSteps():[...new Set(rules.flatMap(row=>row.steps))];
`;
  write("tooling/gate/owed.mjs",policy);git("init","-qb","main");git("add",".");git("commit","-qm","stable selector");
  return {repo,git,write,policy,base:git("rev-parse","HEAD"),commit:()=>{git("add",".");git("commit","-qm","candidate");return selectRange(repo,`${git('rev-parse','HEAD^')}..HEAD`);}};
}

test("a new census leaf uses candidate reach when the complete selector identity is unchanged",t=>{
  const f=newPathFixture(t);f.write("tooling/census/new.test.ts","export const control=1;\n");
  const selected=f.commit();assert.deepEqual(selected.checks.steps,['tests','tooling']);
  assert.deepEqual(selected.views[0].rules.map(row=>row.name),['always']);
});
test("a new leaf plus a selector edit retains the base fallback",t=>{
  const f=newPathFixture(t);f.write("tooling/census/new.test.ts","export const control=1;\n");
  f.write("tooling/gate/owed.mjs",f.policy+'\n// one-line policy edit\n');
  assert.ok(f.commit().checks.steps.includes('full'));
});
test("a new file named by a gate script keeps its actual reader step",t=>{
  const f=newPathFixture(t);f.write("tooling/conformance/named-new.ts","export const control=1;\n");
  assert.deepEqual(f.commit().checks.steps,['tests','profile']);
});
test("transitive imports and rule data both prevent stable-selector narrowing when changed",t=>{
  for(const path of ['tooling/gate/policy.ts','tooling/gate/rules.json']){
    const f=newPathFixture(t);f.write("tooling/census/new.test.ts","export const control=1;\n");
    f.write(path,path.endsWith('.ts')?"export const leafStep='tooling'; // changed helper\n":"{\"version\":2}\n");
    assert.ok(f.commit().checks.steps.includes('full'),path);
  }
});

test("the real unchanged selector reaches a newly added census test without a core fallback",async t=>{
  const directory=mkdtempSync(join(tmpdir(),"owed-real-leaf-"));
  const repo=join(directory,basename(directory)+"-repo"),env={...process.env,GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t"};
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const git=(...args:string[])=>execFileSync("git",["-c","core.hooksPath=/dev/null",...args],{cwd:repo,env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  fixtureRepository(t,repo,env);
  const base=git("rev-parse","HEAD"),path="tooling/census/new-scope-control.test.ts";
  writeFileSync(join(repo,path),"import {test} from 'node:test';test('new leaf',()=>{});\n");git("add",path);git("commit","-qm","new leaf");
  const selected=selectRange(repo,`${base}..HEAD`);
  assert.deepEqual(selected.candidateNewPaths?.paths,[path]);
  assert.ok(selected.checks.steps.includes("tooling"));
  assert.equal(selected.views.some(view=>view.rules.some(rule=>rule.name==="owes the full gate")),false);
  assert.ok(selected.checks.steps.length<10,JSON.stringify(selected.checks));
});
