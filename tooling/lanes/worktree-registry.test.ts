import {test} from "node:test";
import assert from "node:assert/strict";
import {parseWorktreeRegistry} from "./worktree-registry.ts";
test("porcelain NUL records preserve literal paths, refs and registry flags",()=>{
  const text=["worktree /main","HEAD "+"a".repeat(40),"branch refs/heads/main","","worktree /space and\nnewline","HEAD "+"b".repeat(40),"detached","locked operator note\ncontinued","prunable missing path","future-field ignored","",""].join("\0");
  assert.deepEqual(parseWorktreeRegistry(text),[
    {path:"/main",head:"a".repeat(40),branch:"main"},
    {path:"/space and\nnewline",head:"b".repeat(40),branch:"(detached)",locked:"operator note\ncontinued",prunable:"missing path"},
  ]);
});
test("bare registrations and empty lock reasons remain explicit",()=>{
  assert.deepEqual(parseWorktreeRegistry("worktree /bare\0bare\0locked\0\0"),[{path:"/bare",head:"",branch:"(bare)",locked:""}]);
  assert.throws(()=>parseWorktreeRegistry("HEAD abc\0\0"),/omitted its path/);
});
