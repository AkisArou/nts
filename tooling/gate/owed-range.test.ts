import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createServer, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { selectRange, selectionInfrastructure, unionViews, type RuleView } from "./owed-range.ts";
import {committedChanges} from "./change-paths.ts";
import {waitFor} from "./test-wait.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
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

test("a removed step remains explicit instead of disappearing behind candidate all", () => {
  const got = unionViews([view("all", null, null, ["build", "retired"]), view("all", null, null, ["build"])]);
  assert.deepEqual(got.steps, ["build", "retired"]);
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

test("concurrent range preflights have distinct endpoint registry names and collect only their own trees", async t => {
  const directory=mkdtempSync(join(tmpdir(),"owed-concurrent-")),repo=join(directory,"repo");
  const sockets=new Set<Socket>(),seen:string[]=[];
  let pair:Socket[]=[],aborted=false;
  const server=createServer(socket=>{
    sockets.add(socket);socket.on("close",()=>sockets.delete(socket));
    let input="";
    socket.on("data",bytes=>{
      input+=bytes;
      if(!input.endsWith("\n"))return;
      seen.push(JSON.parse(input));pair.push(socket);
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
  const script=`import {selectRange} from ${JSON.stringify(new URL("./owed-range.ts",import.meta.url).href)};console.log(JSON.stringify(selectRange(process.argv[1],process.argv[2]).checks));`;
  const run=()=>{
    const child=spawn(process.execPath,["--input-type=module","-e",script,repo,`${base}..HEAD`],{env,stdio:["ignore","pipe","pipe"]});children.push(child);
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
  assert.equal(git("worktree","list","--porcelain").split("\n").filter(line=>line.startsWith("worktree ")).length,1,"neither preflight leaves a registered endpoint");
});

test("a rule cannot narrow its own committed range and dirty policy cannot alter it", t => {
  const directory = mkdtempSync(join(tmpdir(), "owed-range-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repo = join(directory, "repo");
  const env = { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_") && !/GIT_(AUTHOR|COMMITTER)_/.test(key)) delete env[key];
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  execFileSync("git", ["clone", "--quiet", "--shared", ROOT, repo], { env, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("sh", [join(ROOT, "tooling/lanes/inputs.sh"), "lane", ROOT, repo], { env, stdio: ["ignore", "pipe", "pipe"] });
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
  assert.equal(worktrees.split("\n").filter(l => l.startsWith("worktree ")).length, 1, "endpoint trees are collected");
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
 const actual=execFileSync("sh",["-c","command -v git"],{encoding:"utf8"}).trim(),bin=join(repo,"bin");mkdirSync(bin);
 const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
 writeFileSync(join(bin,"git"),`#!/bin/sh\nif [ "$1" = worktree ] && [ "$2" = add ]; then echo 'resource unavailable' >&2; exit 75; fi\nexec ${quote(actual)} "$@"\n`);chmodSync(join(bin,"git"),0o755);
 const prior=process.env.PATH;t.after(()=>{process.env.PATH=prior;});process.env.PATH=`${bin}:${prior}`;
 assert.throws(()=>selectRange(repo,`${base}..HEAD`),error=>selectionInfrastructure(error)&&String(error).includes("resource unavailable"));
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

test("the real unchanged selector reaches a newly added census test without a core fallback",t=>{
  const directory=mkdtempSync(join(tmpdir(),"owed-real-leaf-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const repo=join(directory,"repo"),env={...process.env,GIT_AUTHOR_NAME:"t",GIT_AUTHOR_EMAIL:"t@t",GIT_COMMITTER_NAME:"t",GIT_COMMITTER_EMAIL:"t@t"};
  const git=(...args:string[])=>execFileSync("git",args,{cwd:repo,env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  execFileSync("git",["clone","--quiet","--shared",ROOT,repo],{env,stdio:["ignore","pipe","pipe"]});
  execFileSync("sh",[join(ROOT,"tooling/lanes/inputs.sh"),"lane",ROOT,repo],{env,stdio:["ignore","pipe","pipe"]});
  const base=git("rev-parse","HEAD"),path="tooling/census/new-scope-control.test.ts";
  writeFileSync(join(repo,path),"import {test} from 'node:test';test('new leaf',()=>{});\n");git("add",path);git("commit","-qm","new leaf");
  const selected=selectRange(repo,`${base}..HEAD`);
  assert.deepEqual(selected.candidateNewPaths?.paths,[path]);
  assert.ok(selected.checks.steps.includes("tooling"));
  assert.equal(selected.views.some(view=>view.rules.some(rule=>rule.name==="owes the full gate")),false);
  assert.ok(selected.checks.steps.length<10,JSON.stringify(selected.checks));
});
