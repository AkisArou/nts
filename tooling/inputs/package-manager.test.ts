import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {availableParallelism,userInfo,tmpdir} from "node:os";
import {dirname,isAbsolute,join,relative} from "node:path";
import {test} from "node:test";
import {spawnTest} from "../gate/test-wait.ts";
import {HISTORICAL_PACKAGE_MANAGERS,managerArchive,packageManagerPin,withPackageManager} from "./package-manager.ts";

test("historical main pins and new pins have one exact authority",()=>{
  assert.deepEqual(Object.keys(HISTORICAL_PACKAGE_MANAGERS),["pnpm@10.15.0"]);
  const old=packageManagerPin("pnpm@10.15.0"),current=packageManagerPin(old.spec);
  assert.equal(old.sha512,current.sha512);assert.equal(old.spec,current.spec);
  assert.equal(Object.isFrozen(HISTORICAL_PACKAGE_MANAGERS),true);
  assert.throws(()=>packageManagerPin("pnpm@10.15.0+sha512."+"0".repeat(128)),/hash conflict for pnpm@10\.15\.0/);
  assert.throws(()=>packageManagerPin("pnpm@10.15.1"),/unknown historical bare spec pnpm@10\.15\.1/);
  assert.throws(()=>packageManagerPin("pnpm@latest"),/invalid packageManager pnpm@latest/);
});

test("offline manager is private, runs with this Node and is deleted after use",async t=>{
  const root=mkdtempSync(join(tmpdir(),"nts-manager-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const ambientWorkers=process.env.PNPM_WORKERS,ambientCache=process.env.NODE_COMPILE_CACHE;
  process.env.PNPM_WORKERS='untrusted-launcher';process.env.NODE_COMPILE_CACHE=join(root,'untrusted-shell-cache');
  t.after(()=>{if(ambientWorkers===undefined)delete process.env.PNPM_WORKERS;else process.env.PNPM_WORKERS=ambientWorkers;if(ambientCache===undefined)delete process.env.NODE_COMPILE_CACHE;else process.env.NODE_COMPILE_CACHE=ambientCache;});
  const source=join(root,"source"),tree=join(root,"tree"),cache=join(root,"cache");
  mkdirSync(join(source,"package/bin"),{recursive:true});mkdirSync(tree);
  writeFileSync(join(source,"package/package.json"),JSON.stringify({name:"pnpm",version:"99.0.0",bin:{pnpm:"bin/pnpm.cjs"}}));
  writeFileSync(join(source,"package/bin/pnpm.cjs"),"console.log(JSON.stringify({node:process.execPath,version:process.version,file:__filename,args:process.argv.slice(2),workers:process.env.PNPM_WORKERS??null,temporary:process.env.TMPDIR??null,compileCache:process.env.NODE_COMPILE_CACHE??null,enabledCache:require('node:module').enableCompileCache()}));\n");
  const packed=join(root,"fixture.tgz"),made=spawnTest("tar",["-czf",packed,"-C",source,"package"],{encoding:"utf8"});
  assert.equal(made.status,0,made.stderr);
  const bytes=readFileSync(packed),pin=packageManagerPin("pnpm@99.0.0+sha512."+createHash("sha512").update(bytes).digest("hex"));
  writeFileSync(join(tree,"package.json"),JSON.stringify({packageManager:pin.spec}));
  const archive=managerArchive(pin,cache);mkdirSync(dirname(archive),{recursive:true});writeFileSync(archive,bytes);
  let executed="";
  await withPackageManager(tree,{cache},async manager=>{
    const first=JSON.parse(await manager.run(["--probe"]));executed=first.file;
    assert.equal(first.node,process.execPath);assert.equal(first.version,process.version);
    assert.equal(first.workers,null,'ambient worker settings cannot enter the pinned manager');
    assert.deepEqual(first.args,["--config.manage-package-manager-versions=false","--probe"]);
    assert.equal(existsSync(executed),true);assert.ok(executed.startsWith(join(cache,"executing")+"/"));
    t.diagnostic("package-manager storage: "+JSON.stringify({temporary:first.temporary,compileCache:first.compileCache,enabledCache:first.enabledCache}));
    assert.equal(typeof first.temporary,"string","the rebuilt manager environment must retain an owned temporary");
    assert.equal(isAbsolute(first.temporary),true);
    const temporaryFromCache=relative(join(userInfo().homedir,".cache"),first.temporary);
    assert.ok(temporaryFromCache!==".."&&!temporaryFromCache.startsWith("../")&&!isAbsolute(temporaryFromCache));
    assert.equal(first.compileCache,join(userInfo().homedir,".cache/nts/node-compile-cache/v1"));
    // Node reports the base on first enable, and its version directory when already enabled.
    assert.ok(first.enabledCache.directory===first.compileCache||first.enabledCache.directory.startsWith(first.compileCache+"/"),JSON.stringify(first.enabledCache));
    const second=JSON.parse(await manager.run(["--probe"]));assert.equal(second.file,executed);
    assert.equal(second.temporary,first.temporary);assert.equal(second.compileCache,first.compileCache);
  });
  assert.equal(existsSync(executed),false);assert.deepEqual(readFileSync(archive),bytes);
  await withPackageManager(tree,{cache,workers:1},async manager=>{
    const bounded=JSON.parse(await manager.run(['--probe']));
    assert.equal(bounded.workers,String(availableParallelism()));
    assert.equal(Math.max(2,availableParallelism()-Number(bounded.workers))-1,1,'the pinned pnpm formula selects one worker');
  });
  // A corrupted cache is rejected before extraction or a manager callback.
  writeFileSync(archive,Buffer.concat([bytes,Buffer.from([1])]));let reached=false;
  await assert.rejects(withPackageManager(tree,{cache},async()=>{reached=true;}),/cache hash mismatch for pnpm@99\.0\.0/);
  assert.equal(reached,false);
});

test("missing offline cache is named and never acquired implicitly",async t=>{
  const root=mkdtempSync(join(tmpdir(),"nts-manager-missing-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const cache=join(root,"missing");writeFileSync(join(root,"package.json"),JSON.stringify({packageManager:"pnpm@10.15.0"}));
  await assert.rejects(withPackageManager(root,{cache},async()=>{}),/cache missing for pnpm@10\.15\.0\+sha512/);
  assert.equal(existsSync(cache),false);
});
