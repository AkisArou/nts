import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";
import {spawnTest} from "../gate/test-wait.ts";
import {nodeEnvironment} from "./node-environment.ts";

test("node children keep canonical behavior under contaminated launchers",()=>{
  const root=mkdtempSync(join(homedir(),".cache/node-env-control-"));
  const paths={TMPDIR:join(root,"tmp"),NODE_TEST_DIR:join(root,"tests")};
  try {
    const clean=nodeEnvironment({PATH:process.env.PATH,HOME:homedir()},paths);
    const dirty=nodeEnvironment({...clean,FORCE_COLOR:"1",TERM:"xterm",TZ:"Pacific/Honolulu",LANG:"C",LC_ALL:"C",
      NODE_OPTIONS:"--require /does/not/exist",NODE_NO_WARNINGS:"1",NO_COLOR:"1",NODE_DEBUG:"net",UNRELATED_CONTROL:"present"},paths);
    assert.deepEqual(dirty,clean);
    const child=spawnTest(process.execPath,["-e",`process.stdout.write(JSON.stringify({force:process.env.FORCE_COLOR,term:process.env.TERM,tz:process.env.TZ,locale:process.env.LC_ALL,options:process.env.NODE_OPTIONS??null,extra:process.env.UNRELATED_CONTROL??null}));process.emitWarning('canonical warning control');`],{env:dirty,encoding:"utf8"});
    assert.equal(child.status,0,child.stderr);
    assert.deepEqual(JSON.parse(child.stdout),{force:"0",term:"dumb",tz:"UTC",locale:"C.UTF-8",options:null,extra:null});
    assert.match(child.stderr,/canonical warning control/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
