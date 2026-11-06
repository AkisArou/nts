import assert from "node:assert/strict";
import {test} from "node:test";
import {existsSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {homedir,tmpdir} from "node:os";
import {join} from "node:path";
import {spawnTest} from "../gate/test-wait.ts";
import {nodeEnvironment,OWNER_MARK,sweepLeftovers} from "./node-environment.ts";

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

test("a runner's own directories are marked and removed when it exits, and kept with NTS_KEEP_TEMP",t=>{
  const home=mkdtempSync(join(tmpdir(),"node-env-home-"));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  const run=(extra:NodeJS.ProcessEnv)=>{
    const script=`import {existsSync,readFileSync} from "node:fs";import {join} from "node:path";
      const {nodeEnvironment,OWNER_MARK}=await import(${JSON.stringify(new URL("./node-environment.ts",import.meta.url).href)});
      const env=nodeEnvironment(JSON.parse(process.argv[1]));
      process.stdout.write(JSON.stringify({pid:process.pid,tmp:env.TMPDIR,test:env.NODE_TEST_DIR,during:[existsSync(env.TMPDIR),existsSync(env.NODE_TEST_DIR)],
        mark:readFileSync(join(env.NODE_TEST_DIR,OWNER_MARK),"utf8").trim()}));`;
    const child=spawnTest(process.execPath,["--input-type=module","-e",script,JSON.stringify({PATH:process.env.PATH,HOME:home,...extra})],{encoding:"utf8"});
    assert.equal(child.status,0,child.stderr);
    return JSON.parse(child.stdout) as {pid:number;tmp:string;test:string;during:boolean[];mark:string};
  };
  const first=run({});
  assert.equal(first.test,join(home,".cache",`n${first.pid.toString(36)}`),"short enough for node's socket names");
  assert.equal(first.tmp,join(home,".cache/nts-conformance",String(first.pid),"tmp"));
  assert.deepEqual(first.during,[true,true]);
  assert.equal(first.mark,String(first.pid));
  assert.ok(!existsSync(first.test)&&!existsSync(join(home,".cache/nts-conformance",String(first.pid))),"removed at exit");
  const kept=run({NTS_KEEP_TEMP:"1"});
  assert.equal(kept.mark,`${kept.pid} kept`);
  assert.ok(existsSync(kept.test)&&existsSync(kept.tmp),"NTS_KEEP_TEMP keeps them");
});

test("the next runner removes what a killed one left, and touches nothing it did not mark",t=>{
  const home=mkdtempSync(join(tmpdir(),"node-env-home-"));
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  const cache=join(home,".cache"),dead=2147483646;
  const folder=(path:string,mark?:string)=>{
    mkdirSync(join(cache,path),{recursive:true});
    if(mark!==undefined)writeFileSync(join(cache,path,OWNER_MARK),`${mark}\n`);
  };
  folder(`n${dead.toString(36)}/.tmp.${dead}`);writeFileSync(join(cache,`n${dead.toString(36)}`,OWNER_MARK),`${dead}\n`);
  folder(`nts-conformance/${dead}/tmp`);writeFileSync(join(cache,"nts-conformance",String(dead),OWNER_MARK),`${dead}\n`);
  folder(`n${process.pid.toString(36)}`,String(process.pid));
  folder(`n${(dead-1).toString(36)}`,`${dead-1} kept`);
  folder("n2a3b");
  folder("nvim");writeFileSync(join(cache,"nvim/init.lua"),"-- a tool's own\n");
  assert.equal(sweepLeftovers(home),2);
  assert.ok(!existsSync(join(cache,`n${dead.toString(36)}`))&&!existsSync(join(cache,"nts-conformance",String(dead))));
  for(const left of [`n${process.pid.toString(36)}`,`n${(dead-1).toString(36)}`,"n2a3b","nvim/init.lua"])assert.ok(existsSync(join(cache,left)),left);
});
