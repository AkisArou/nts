import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { command, registryInputsFixture, REGISTRY_FIXTURE_MARKER,
  REGISTRY_FIXTURE_PACKAGE, treeIdentity } from "./registry-inputs-fixture.ts";

const inputs = fileURLToPath(new URL("../lanes/inputs.sh", import.meta.url));
const prepare = (fixture: Awaited<ReturnType<typeof registryInputsFixture>>) =>
  command("sh", [inputs, "lane", fixture.main, fixture.frozen], fixture.root);

test("a frozen candidate gets its new registry dev dependency before main has it", async t => {
  const fixture = await registryInputsFixture(t);
  const prepared = await prepare(fixture);
  assert.equal(treeIdentity(fixture.main), fixture.mainIdentity, "preparation changed main");
  assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
  const probe = await command(process.execPath, [join(fixture.frozen, "test/new-importer/probe.mjs")], fixture.frozen);
  assert.equal(probe.status, 0, `${REGISTRY_FIXTURE_PACKAGE} was not materialized offline:\n${probe.stderr}`);
  assert.equal(probe.stdout.trim(), REGISTRY_FIXTURE_MARKER);
});

test("a manifest/lock mismatch names the registry package and refuses without main fallback", async t => {
  const fixture = await registryInputsFixture(t);
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
  const fixture = await registryInputsFixture(t);
  const path = join(fixture.frozen, "pnpm-lock.yaml");
  const lock = readFileSync(path, "utf8");
  assert.ok(lock.includes(fixture.integrity));
  writeFileSync(path, lock.replaceAll(fixture.integrity, "sha512-" + Buffer.alloc(64).toString("base64")));
  const prepared = await prepare(fixture);
  assert.equal(treeIdentity(fixture.main), fixture.mainIdentity, "preparation changed main");
  assert.notEqual(prepared.status, 0, "unverified package bytes cannot use main's modules");
  assert.ok((prepared.stdout + prepared.stderr).includes(REGISTRY_FIXTURE_PACKAGE));
});
