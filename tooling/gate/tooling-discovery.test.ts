import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {collectToolingTests,discoverToolingTests,isToolingTest,parseToolingTestExclusions,toolingTestInventory,toolingTestStep,validateToolingCoverage} from "./tooling-discovery.ts";

function fixture(t:{after:(fn:()=>void)=>void}):{root:string;file:(path:string)=>void} {
  const root=mkdtempSync(join(tmpdir(),"tooling-discovery-"));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  execFileSync("git",["init","--quiet",root]);
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
  const old=collectToolingTests(root).filter(path=>/^tooling\/(gate|lanes|census|apple)\/[^/]+$/.test(path));
  assert.throws(()=>validateToolingCoverage(toolingTestInventory(root),old,[]),/neither collected nor explicitly excluded/);
});
test("Git inventory covers tracked, untracked and ignored tests without shell splitting",t=>{
  const {root,file}=fixture(t);
  file("tooling/tracked.test.ts");execFileSync("git",["add","tooling"],{cwd:root});
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
  assert.equal(isToolingTest("tooling/another/nested.test.mjs"),true);
});
