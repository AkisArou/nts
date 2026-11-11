import {fixtureEnvironment} from "./test-environment.ts";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync} from "node:fs";
import {userInfo} from "node:os";
import {dirname, join} from "node:path";
import {test, type TestContext} from "node:test";
import {testScratch} from "./test-scratch.ts";
import {spawnTest} from "./test-wait.ts";

function fixture(t: TestContext) {
  const account=userInfo().homedir,root=testScratch(t,"account-home"),selected=join(root,"consumer-home"),temporary=join(root,"run/tmp");
  // An existing owned directory outside both cache roots; no outside scratch is needed.
  const outside=account;
  mkdirSync(join(selected, ".cache/run/tmp"), {recursive: true}); mkdirSync(temporary, {recursive: true});
  const source = join(root, "archive-source/package/bin"), cache = join(root, "tool-cache"), project = join(root, "project");
  mkdirSync(source, {recursive: true}); mkdirSync(project);
  writeFileSync(join(source, "pnpm.cjs"), "console.log(JSON.stringify({temporary:process.env.TMPDIR,cache:process.env.NODE_COMPILE_CACHE}));\n");
  writeFileSync(join(dirname(source), "package.json"), JSON.stringify({name: "pnpm", version: "99.0.0", bin: {pnpm: "bin/pnpm.cjs"}}));
  const tarball = join(root, "pnpm.tgz"), tar = spawnTest("tar", ["-czf", tarball, "-C", join(root, "archive-source"), "package"], {encoding: "utf8"});
  assert.equal(tar.status, 0, tar.stderr);
  const bytes = readFileSync(tarball), hash = createHash("sha512").update(bytes).digest("hex");
  const archive = join(cache, "pnpm", hash, "pnpm.tgz"); mkdirSync(dirname(archive), {recursive: true}); writeFileSync(archive, bytes);
  writeFileSync(join(project, "package.json"), JSON.stringify({packageManager: `pnpm@99.0.0+sha512.${hash}`}));
  return {root, account, selected, temporary, outside, cache, project};
}

const actor = `
import assert from 'node:assert/strict';
import {ownedCacheEnvironment,NODE_COMPILE_CACHE_ROOT} from ${JSON.stringify(new URL("./canonical-environment.ts", import.meta.url).href)};
import {captureRunTemporary,assertRunTemporary} from ${JSON.stringify(new URL("./run-temporary.ts", import.meta.url).href)};
import {withPackageManager} from ${JSON.stringify(new URL("../inputs/package-manager.ts", import.meta.url).href)};
import {pruneNodeCompileCache} from ${JSON.stringify(new URL("../full-check/node-cache-retention.ts", import.meta.url).href)};
import {join} from 'node:path';
const f=JSON.parse(process.argv[1]),kind=process.argv[2],expected=join(f.account,'.cache/nts/node-compile-cache/v1');
if(kind==='outside'||kind==='foreign'){
  const temporary=kind==='outside'?f.outside:join(f.selected,'.cache/foreign/etc');
  assert.throws(()=>ownedCacheEnvironment(process.env,{temporary}),/owned Node cache temporary/);
}else if(kind==='manager'){
  const result=await withPackageManager(f.project,{cache:f.cache},manager=>manager.run(['--version']));
  const data=JSON.parse(result);assert.ok(data.temporary.startsWith(join(f.cache,'executing')+'/'));assert.equal(data.cache,expected);
}else if(kind==='selected'){
  const temporary=join(f.selected,'.cache/run/tmp');assert.equal(ownedCacheEnvironment(process.env,{temporary}).TMPDIR,temporary);
}else if(kind==='pruner'){
  assert.equal(NODE_COMPILE_CACHE_ROOT,expected);
  // Keep even the obsolete ambient-HOME relative calculation inside this
  // private tree; this control must never collect the real shared cache.
  const home=join(f.root,'private-retention-home','a','b','c','d','e','f','g','h'),data=pruneNodeCompileCache({home});
  assert.equal(data.root,join(home,'.cache/nts/node-compile-cache/v1'));assert.equal(data.state,'missing');
}else{
  const storage=ownedCacheEnvironment(process.env,{temporary:f.temporary});
  assert.equal(storage.TMPDIR,f.temporary);assert.equal(storage.NODE_COMPILE_CACHE,expected);assert.equal(NODE_COMPILE_CACHE_ROOT,expected);
  assertRunTemporary(captureRunTemporary(join(f.root,'run')),process.env.HOME??'');
}
console.log(JSON.stringify({kind,account:f.account,selected:process.env.HOME??null,root:NODE_COMPILE_CACHE_ROOT}));
`;

for (const kind of ["account", "manager", "outside", "foreign", "selected", "unset", "empty", "pruner"] as const) {
  test(`account cache authority with a consumer HOME: ${kind}`, t => {
    const f = fixture(t);
    if (kind === "foreign") {
      if (!process.getuid || statSync("/etc").uid === process.getuid()) {t.skip("requires a directory owned by another account"); return;}
      symlinkSync("/", join(f.selected, ".cache/foreign"));
      assert.notEqual(statSync(join(f.selected, ".cache/foreign/etc")).uid, process.getuid());
    }
    const env: NodeJS.ProcessEnv = {...fixtureEnvironment(t), HOME: kind === "empty" ? "" : f.selected};
    for (const name of Object.keys(env)) if (name.startsWith("NTS_") || name.startsWith("NODE_TEST_")) delete env[name];
    if (kind === "unset") delete env.HOME;
    const actual = spawnTest(process.execPath, ["--input-type=module", "-e", actor, JSON.stringify(f), kind], {env, encoding: "utf8"});
    t.diagnostic(JSON.stringify({kind,account:f.account,home:env.HOME??null,status:actual.status,stdout:actual.stdout,stderr:actual.stderr}));
    assert.equal(actual.signal, null); assert.equal(actual.status, 0, actual.stdout + actual.stderr);
  });
}
