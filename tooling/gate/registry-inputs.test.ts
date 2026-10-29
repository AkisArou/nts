import assert from "node:assert/strict";
import {acquireRevision,dependencyCache} from "../lanes/dependency-inputs.ts";
import { readFileSync, writeFileSync, rmSync, readdirSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { command, registryInputsFixture, REGISTRY_FIXTURE_MARKER,
  REGISTRY_FIXTURE_PACKAGE, SECOND_REGISTRY_PACKAGE, SECOND_REGISTRY_MARKER, treeIdentity } from "./registry-inputs-fixture.ts";

const inputs = fileURLToPath(new URL("../lanes/inputs.sh", import.meta.url));
const prepare = (fixture: Awaited<ReturnType<typeof registryInputsFixture>>) => {
  const home=join(fixture.root,"consumer-home");mkdirSync(home,{recursive:true});
  return command("sh", [inputs, "lane", fixture.main, fixture.frozen], fixture.root,undefined,{HOME:home,COREPACK_ENABLE_NETWORK:"0"});
};

test("a frozen candidate gets its new registry dev dependency before main has it", async t => {
  const fixture = await registryInputsFixture(t,async fixture=>{const cache=dependencyCache(fixture.main);t.after(()=>rmSync(cache,{recursive:true,force:true}));await acquireRevision(fixture.main,fixture.candidate,"HEAD");});
  const prepared = await prepare(fixture);
  assert.equal(treeIdentity(fixture.main), fixture.mainIdentity, "preparation changed main");
  assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
  const probe = await command(process.execPath, [join(fixture.frozen, "test/new-importer/probe.mjs")], fixture.frozen);
  assert.equal(probe.status, 0, `${REGISTRY_FIXTURE_PACKAGE} was not materialized offline:\n${probe.stderr}`);
  assert.equal(probe.stdout.trim(), REGISTRY_FIXTURE_MARKER);
});

test("a manifest/lock mismatch names the registry package and refuses without main fallback", async t => {
  const fixture = await registryInputsFixture(t,async fixture=>{const cache=dependencyCache(fixture.main);t.after(()=>rmSync(cache,{recursive:true,force:true}));await acquireRevision(fixture.main,fixture.candidate,"HEAD");});
  const path = join(fixture.frozen, "test/new-importer/package.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.devDependencies[REGISTRY_FIXTURE_PACKAGE] = "2.0.0";
  writeFileSync(path, JSON.stringify(manifest));
  const prepared = await prepare(fixture);
  assert.equal(treeIdentity(fixture.main), fixture.mainIdentity, "preparation changed main");
  assert.notEqual(prepared.status, 0, "a changed manifest cannot use main's modules");
  assert.ok((prepared.stdout + prepared.stderr).includes(REGISTRY_FIXTURE_PACKAGE));
});

test("an integrity mismatch names the registry package and refuses with the registry closed", async t => {
  const fixture = await registryInputsFixture(t,async fixture=>{const cache=dependencyCache(fixture.main);t.after(()=>rmSync(cache,{recursive:true,force:true}));await acquireRevision(fixture.main,fixture.candidate,"HEAD");});
  const path = join(fixture.frozen, "pnpm-lock.yaml");
  const lock = readFileSync(path, "utf8");
  assert.ok(lock.includes(fixture.integrity));
  writeFileSync(path, lock.replaceAll(fixture.integrity, "sha512-" + Buffer.alloc(64).toString("base64")));
  const prepared = await prepare(fixture);
  assert.equal(treeIdentity(fixture.main), fixture.mainIdentity, "preparation changed main");
  assert.notEqual(prepared.status, 0, "unverified package bytes cannot use main's modules");
  assert.ok((prepared.stdout + prepared.stderr).includes(REGISTRY_FIXTURE_PACKAGE));
});

test("concurrent acquisition publishes one complete identity and leaves main unchanged",async t=>{
  const fixture=await registryInputsFixture(t,async fixture=>{
    const cache=dependencyCache(fixture.main);t.after(()=>rmSync(cache,{recursive:true,force:true}));
    const before=fixture.registryRequests.filter(path=>path.endsWith("/-/package.tgz")).length;
    const keys=await Promise.all([acquireRevision(fixture.main,fixture.candidate,"HEAD"),acquireRevision(fixture.main,fixture.candidate,"HEAD")]);
    assert.equal(keys[0],keys[1]);
    assert.equal(fixture.registryRequests.filter(path=>path.endsWith("/-/package.tgz")).length-before,1,"the second acquisition uses the published content identity");
    const records=readdirSync(join(cache,"identities")).filter(name=>name.endsWith(".json"));assert.equal(records.length,1);
    const row=JSON.parse(readFileSync(join(cache,"identities",records[0]),"utf8"));assert.equal(row.identity.key,keys[0]);assert.equal(row.acquired,true);
  });
  const result=await prepare(fixture);assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(treeIdentity(fixture.main),fixture.mainIdentity);
});

test("a new composed lock uses the acquired content offline rather than requiring its own fetch",async t=>{
  const fixture=await registryInputsFixture(t,async fixture=>{
    const cache=dependencyCache(fixture.main);t.after(()=>rmSync(cache,{recursive:true,force:true}));await acquireRevision(fixture.main,fixture.candidate,"HEAD");
    const second=join(fixture.root,"second-candidate"),cloned=await command("git",["clone","--quiet","--no-hardlinks",fixture.main,second],fixture.root);assert.equal(cloned.status,0,cloned.stderr);
    const importer=join(second,"test/second-importer");mkdirSync(importer,{recursive:true});
    writeFileSync(join(importer,"package.json"),JSON.stringify({name:"second-importer",private:true,type:"module",devDependencies:{[SECOND_REGISTRY_PACKAGE]:"1.0.0"}}));
    const installed=await command("pnpm",["install","--ignore-scripts","--fetch-retries=0"],second);assert.equal(installed.status,0,installed.stdout+installed.stderr);
    const added=await command("git",["add","pnpm-lock.yaml","test/second-importer"],second);assert.equal(added.status,0,added.stderr);
    const committed=await command("git",["-c","user.name=Fixture","-c","user.email=fixture@example.invalid","-c","core.hooksPath=/dev/null","-c","commit.gpgsign=false","commit","-qm","second independent dependency"],second);assert.equal(committed.status,0,committed.stderr);
    await acquireRevision(fixture.main,second,"HEAD");
    assert.equal(readdirSync(join(cache,"identities")).filter(name=>name.endsWith(".json")).length,2);
  });
  const importer=join(fixture.frozen,"test/second-importer");mkdirSync(importer,{recursive:true});
  writeFileSync(join(importer,"package.json"),JSON.stringify({name:"second-importer",private:true,type:"module",devDependencies:{[SECOND_REGISTRY_PACKAGE]:"1.0.0"}}));
  writeFileSync(join(importer,"probe.mjs"),`import {marker} from ${JSON.stringify(SECOND_REGISTRY_PACKAGE)};console.log(marker);`);
  const changed=await command("pnpm",["install","--offline","--lockfile-only","--ignore-scripts"],fixture.frozen);assert.equal(changed.status,0,changed.stdout+changed.stderr);
  const lock=readFileSync(join(fixture.frozen,"pnpm-lock.yaml"),"utf8");assert.ok(lock.includes("test/second-importer:"));
  const result=await prepare(fixture);assert.equal(result.status,0,result.stdout+result.stderr);
  const probe=await command(process.execPath,[join(importer,"probe.mjs")],fixture.frozen);assert.equal(probe.status,0,probe.stderr);assert.equal(probe.stdout.trim(),SECOND_REGISTRY_MARKER);assert.equal(treeIdentity(fixture.main),fixture.mainIdentity);
});

test("missing acquired content is an instrument failure even when main has a substitute",async t=>{
  const fixture=await registryInputsFixture(t,async fixture=>{const cache=dependencyCache(fixture.main);t.after(()=>rmSync(cache,{recursive:true,force:true}));await acquireRevision(fixture.main,fixture.candidate,"HEAD");});
  const cache=dependencyCache(fixture.main);
  for(const name of readdirSync(cache))if(name.startsWith("pnpm-"))rmSync(join(cache,name),{recursive:true,force:true});
  const substitute=join(fixture.main,"node_modules",REGISTRY_FIXTURE_PACKAGE);mkdirSync(substitute,{recursive:true});
  writeFileSync(join(substitute,"package.json"),JSON.stringify({type:"module",exports:"./index.js"}));writeFileSync(join(substitute,"index.js"),"export const marker='main fallback';");
  const before=treeIdentity(fixture.main),result=await prepare(fixture);
  assert.notEqual(result.status,0);assert.match(result.stdout+result.stderr,/instrument failure/);assert.ok((result.stdout+result.stderr).includes(REGISTRY_FIXTURE_PACKAGE));assert.equal(treeIdentity(fixture.main),before);
});

test("scoped workspace links bind to the frozen tree while registry content stays offline",async t=>{
  const fixture=await registryInputsFixture(t,async fixture=>{
    const cache=dependencyCache(fixture.main);t.after(()=>rmSync(cache,{recursive:true,force:true}));
    const supplier=join(fixture.candidate,"test/supplier"),importer=join(fixture.candidate,"test/new-importer");mkdirSync(supplier,{recursive:true});
    writeFileSync(join(supplier,"package.json"),JSON.stringify({name:"@nts/fixture-workspace",version:"1.0.0",private:true,type:"module",exports:"./index.js"}));
    writeFileSync(join(supplier,"index.js"),"export const where=import.meta.url;");
    const manifest=JSON.parse(readFileSync(join(importer,"package.json"),"utf8"));manifest.devDependencies["@nts/fixture-workspace"]="workspace:*";writeFileSync(join(importer,"package.json"),JSON.stringify(manifest));
    writeFileSync(join(importer,"workspace-probe.mjs"),"import {where} from '@nts/fixture-workspace';console.log(where);");
    const installed=await command("pnpm",["install","--no-frozen-lockfile","--ignore-scripts","--fetch-retries=0"],fixture.candidate);assert.equal(installed.status,0,installed.stdout+installed.stderr);
    const added=await command("git",["add","pnpm-lock.yaml","test"],fixture.candidate);assert.equal(added.status,0,added.stderr);
    const committed=await command("git",["-c","user.name=Fixture","-c","user.email=fixture@example.invalid","-c","core.hooksPath=/dev/null","-c","commit.gpgsign=false","commit","-qm","workspace supplier"],fixture.candidate);assert.equal(committed.status,0,committed.stderr);
    await acquireRevision(fixture.main,fixture.candidate,"HEAD");
  });
  const result=await prepare(fixture);assert.equal(result.status,0,result.stdout+result.stderr);
  const linked=join(fixture.frozen,"test/new-importer/node_modules/@nts/fixture-workspace");assert.equal(realpathSync(linked),join(fixture.frozen,"test/supplier"));
  const probe=await command(process.execPath,[join(fixture.frozen,"test/new-importer/workspace-probe.mjs")],fixture.frozen);assert.equal(probe.status,0,probe.stderr);assert.equal(probe.stdout.trim(),new URL("test/supplier/index.js",pathToFileURL(fixture.frozen+"/")).href);assert.equal(treeIdentity(fixture.main),fixture.mainIdentity);
});
