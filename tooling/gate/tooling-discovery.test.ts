import {gitArguments} from "./git-arguments/main.ts";
import {fixtureEnvironment} from "./test-environment.ts";
import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {collectToolingTests,discoverToolingTests,isToolingTest,parseToolingTestExclusions,toolingTestInventory,toolingTestStep,toolingTestsForStep,validateToolingCoverage,type ToolingTestExclusion} from "./tooling-discovery.ts";
import {STEPS} from './step-table.mjs';
import {shellCommands} from './shell-commands.ts';

function fixture(t:{after:(fn:()=>void)=>void}):{root:string;file:(path:string)=>void} {
  const root=mkdtempSync(join(tmpdir(),"tooling-discovery-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  execFileSync("git",gitArguments(["init","--quiet",root]), {env:fixtureEnvironment(t)});
  return {root,file(path){mkdirSync(join(root,path,".."),{recursive:true});writeFileSync(join(root,path),"");}};
}
test("recursive discovery reaches omitted folders, nested tests, both suffixes and spaces",t=>{
  const {root,file}=fixture(t);
  const expected=["tooling/bench/a.test.ts","tooling/bootstrap/b.test.ts","tooling/conformance/web-platform/c.test.mjs","tooling/new folder/deeper/d.test.ts"].sort();
  for(const path of [...expected,"tooling/new folder/helper.ts","tooling/node_modules/ignored.test.ts","tooling/a/node_modules/also.test.mjs"])file(path);
  assert.deepEqual(collectToolingTests(root),expected);
  assert.deepEqual(toolingTestInventory(root),expected);
  validateToolingCoverage(toolingTestInventory(root),collectToolingTests(root),[]);
  // The former fixed-folder mechanism omitted these entries altogether.
  const old=collectToolingTests(root).filter(path=>/^tooling\/(gate|inputs|census|apple)\/[^/]+$/.test(path));
  assert.throws(()=>validateToolingCoverage(toolingTestInventory(root),old,[]),/neither collected nor explicitly excluded/);
});
test("Git inventory covers tracked, untracked and ignored tests without shell splitting",t=>{
  const {root,file}=fixture(t);
  file("tooling/tracked.test.ts");execFileSync("git",gitArguments(["add","tooling"]),{env:fixtureEnvironment(t),cwd:root});
  file("tooling/untracked.test.mjs");file("tooling/ignored/hidden.test.ts");
  writeFileSync(join(root,".gitignore"),"tooling/ignored/\n");
  assert.deepEqual(toolingTestInventory(root),["tooling/ignored/hidden.test.ts","tooling/tracked.test.ts","tooling/untracked.test.mjs"]);
  validateToolingCoverage(toolingTestInventory(root),collectToolingTests(root),[]);
});
test("a valid exception names a real owning step and remains an owed test",()=>{
  const path="tooling/bench/measurement.test.ts";
  const rows=parseToolingTestExclusions([{path,reason:"requires the measurement CPU",step:"bench-agree"}],["tooling","bench-agree"]);
  validateToolingCoverage([path,"tooling/gate/control.test.mjs"],["tooling/gate/control.test.mjs"],rows);
  assert.equal(toolingTestStep(path,rows),"bench-agree");
  assert.equal(toolingTestStep("tooling/new/deep.test.ts",rows),"tooling");
  assert.equal(toolingTestStep("tooling/bench/helper.ts",rows),undefined);
});
test('a named step selects exactly its table entries and refuses an empty owner',t=>{
  const {root,file}=fixture(t);
  for(const path of ['tooling/a.test.ts','tooling/b.test.ts','tooling/c.test.ts','tooling/gate/all.sh','tooling/gate/tooling-test-exclusions.json'])file(path);
  writeFileSync(join(root,'tooling/gate/all.sh'),"printf '%s\\n' tooling integrity examples\n");
  const rows=[{path:'tooling/a.test.ts',step:'integrity',reason:'first wide control'},
    {path:'tooling/b.test.ts',step:'integrity',reason:'second wide control'},
    {path:'tooling/c.test.ts',step:'examples',reason:'another owner'}];
  writeFileSync(join(root,'tooling/gate/tooling-test-exclusions.json'),JSON.stringify(rows));
  assert.deepEqual(toolingTestsForStep(root,'integrity'),['tooling/a.test.ts','tooling/b.test.ts']);
  assert.deepEqual(toolingTestsForStep(root,'examples'),['tooling/c.test.ts']);
  assert.throws(()=>toolingTestsForStep(root,'missing'),/no tooling test entries.*missing/);
  rows[1]!.step='examples';writeFileSync(join(root,'tooling/gate/tooling-test-exclusions.json'),JSON.stringify(rows));
  assert.deepEqual(toolingTestsForStep(root,'integrity'),['tooling/a.test.ts']);
  assert.deepEqual(toolingTestsForStep(root,'examples'),['tooling/b.test.ts','tooling/c.test.ts']);
});
function assertStepRunners(rows:readonly ToolingTestExclusion[],steps:Iterable<string>,source:string):void{
  const names=new Set(steps),parsed=shellCommands(source),definitions=[...source.matchAll(/^([a-z_][a-z0-9_]*)\(\) \{/gm)];
  for(const row of rows){
    assert.ok(names.has(row.step),`${row.path}: unknown owning step ${row.step}`);
    const call=parsed.commands.find(command=>command.name==='step'&&command.args[0]?.value===row.step&&!command.args[0].dynamic);
    assert.ok(call,`${row.path}: ${row.step} has no all.sh step invocation`);
    const owner=call.args[1];assert.ok(owner&&!owner.dynamic,`${row.path}: ${row.step} has no literal step body`);
    const at=definitions.findIndex(match=>match[1]===owner.value);assert.ok(at>=0,`${row.path}: missing body ${owner.value}`);
    const definition=definitions[at]!,body=source.slice(definition.index!+definition[0].length,definitions[at+1]?.index??source.length);
    assert.ok(shellCommands(body).commands.some(command=>command.name==='node'&&command.args.length===3
      &&command.args.every(word=>!word.dynamic)&&command.args[0]!.value==='tooling/gate/tooling-runner.ts'
      &&command.args[1]!.value==='--step'&&command.args[2]!.value===row.step),`${row.path}: ${row.step} does not run tooling-runner.ts --step ${row.step}`);
  }
}
test('every excluded test owner has a real step body running that table selection',()=>{
  const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),selection=discoverToolingTests(root);
  assertStepRunners(selection.exclusions,STEPS.map(row=>row.name),readFileSync(join(root,'tooling/gate/all.sh'),'utf8'));
  const row={path:'tooling/private.test.ts',step:'integrity',reason:'owned control'};
  const script='integrity() {\n  node tooling/gate/tooling-runner.ts --step integrity\n}\nstep "integrity" integrity\n';
  assertStepRunners([row],['integrity'],script);
  assert.throws(()=>assertStepRunners([row],[],script),/private.test.ts.*unknown owning step integrity/);
  assert.throws(()=>assertStepRunners([row],['integrity'],script.replace('--step integrity','--step examples')),/private.test.ts.*integrity does not run/);
  assert.throws(()=>assertStepRunners([row],['integrity'],script.replace('node tooling/gate/tooling-runner.ts --step integrity','# node tooling/gate/tooling-runner.ts --step integrity')),/private.test.ts.*integrity does not run/);
});
test("exceptions reject unknown owners, absent reasons, non-exact paths and duplicates",()=>{
  const good={path:"tooling/bench/a.test.ts",reason:"owned measurement",step:"bench-agree"};
  const steps=["tooling","bench-agree"];
  for(const bad of [null,{},[{}],[{...good,step:"missing"}],[{...good,step:"tooling"}],[{...good,reason:" "}],
    [{...good,path:"tooling/../a.test.ts"}],[{...good,path:"/tooling/a.test.ts"}],[{...good,path:"tooling/*.test.ts"}],
    [{...good,path:"tooling/node_modules/a.test.ts"}],[{...good,extra:true}]])
    assert.throws(()=>parseToolingTestExclusions(bad,steps));
  assert.throws(()=>parseToolingTestExclusions([good,good],steps),/duplicate/);
});
test("coverage refuses missing entries, stale exceptions, duplicates and empty populations",()=>{
  const path="tooling/bench/a.test.ts",row={path,reason:"owned elsewhere",step:"benches"};
  assert.throws(()=>validateToolingCoverage([path],[],[]),/neither collected/);
  assert.throws(()=>validateToolingCoverage([path],[path],[row]),/also excluded/);
  assert.throws(()=>validateToolingCoverage([path],[path,path],[]),/more than once/);
  assert.throws(()=>validateToolingCoverage([path],[path],[{...row,path:"tooling/stale.test.ts"}]),/stale or unknown/);
  assert.throws(()=>validateToolingCoverage([],[],[]),/empty/);
});
test("a symlink cannot silently replace a regular test entry",t=>{
  const {root,file}=fixture(t);file("tooling/original.ts");
  symlinkSync("original.ts",join(root,"tooling/linked.test.ts"));
  assert.throws(()=>collectToolingTests(root),/regular file/);
});
test("the actual tooling tree has no test outside collection or the named exclusion policy",()=>{
  const root=resolve(fileURLToPath(new URL("../..",import.meta.url)));
  const result=discoverToolingTests(root);
  assert.ok(result.files.includes("tooling/gate/tooling-discovery.test.ts"));
  for(const path of ["tooling/bench/run-session.test.ts","tooling/bootstrap/typescript.test.ts","tooling/conformance/provider-family-paths.test.ts","tooling/conformance/web-platform/host-tests.test.ts"])
    assert.ok(result.files.includes(path),path);
  assert.equal(result.files.length+result.exclusions.length,result.inventoryCount);
  const population='tooling/gate/selector-population.test.ts';
  assert.equal(result.files.includes(population),false,'the full population is outside landing tooling');
  assert.equal(result.exclusions.find(row=>row.path===population)?.step,'integrity');
  assert.equal(toolingTestStep(population,result.exclusions),'integrity');
  assert.equal(isToolingTest("tooling/another/nested.test.mjs"),true);
});
