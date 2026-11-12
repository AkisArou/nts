import {testEnvironmentHandoff,fixtureEnvironment} from "../test-environment.ts";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { waitFor } from "../test-wait.ts";
import { GateScopes, reapGateRoot } from "./step-scope.ts";
import { reapRunOwner } from "./run-owner.ts";
import { newTestScratch } from "../test-scratch.ts";

test("a malformed owner start identity cannot make a live process appear dead", () => {
  const own = newTestScratch("run-owner-invalid"), path = join(own, "owner.json");
  const stat = readFileSync("/proc/self/stat", "utf8"), start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]!;
  let reaped = 0;
  try {
    for (const malformed of [Number(start), `0${start}`]) {
      writeFileSync(path, JSON.stringify({ version: 1, nonce: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", pid: process.pid, start: malformed,
        boot: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), slice: `nts-tooling-${"a".repeat(32)}.slice` }));
      assert.throws(() => reapRunOwner(path, () => { reaped++; }), /invalid prior gate root receipt/);
      assert.equal(reaped, 0);
    }
  }
  finally { rmSync(own, { recursive: true, force: true }); }
});

for (const beforeCheckout of [false, true]) test(`the next runner reaps a dead runner's exact root (before checkout=${beforeCheckout})`, async t => {
  const own = newTestScratch("run-owner-run"), receipt = join(own, "owner.json"), info = join(own, "root.json"), ready = join(own, "ready");
  t.after(() => {
    if (existsSync(info)) {
      const { slice } = JSON.parse(readFileSync(info, "utf8")) as { slice: string };
      const stopped = spawnSync("systemctl", ["--user", "stop", slice], {env:fixtureEnvironment(t), encoding: "utf8" });
      assert.equal(stopped.status, 0, stopped.stderr);
    }
    rmSync(own, { recursive: true, force: true });
  });
  const code = `import {spawn} from 'node:child_process';import {durableRecord} from ${JSON.stringify(new URL('../durable-record.ts',import.meta.url).href)};
import{GateScopes}from${JSON.stringify(new URL("./step-scope.ts", import.meta.url).href)};
const owner=new GateScopes(process.env,${JSON.stringify(receipt)}),step=owner.step({max:2**31});
const command=step.command(process.execPath,['-e',${JSON.stringify(`const fs=require('node:fs');fs.watch(${JSON.stringify(own)},()=>{});fs.writeFileSync(${JSON.stringify(ready)},'ready');`)}]);
spawn(command.command,command.args,{detached:true,stdio:'ignore',env:{...${testEnvironmentHandoff()},NTS_TOOLING_SLICE:step.slice}}).unref();
durableRecord(${JSON.stringify(info)},{slice:owner.slice,group:owner.group});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {env:fixtureEnvironment(t), stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; child.stderr.on("data", part => { stderr += part; });
  const status = await new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  assert.equal(status, 0, stderr);
  assert.equal(existsSync(receipt), true, "the old runner publishes its owned root before work starts");
  await waitFor("the abandoned scope to begin its controlled work", () => existsSync(ready));
  const previous = JSON.parse(readFileSync(info, "utf8")) as { group: string };
  if (beforeCheckout) {
    reapGateRoot(receipt);
    assert.equal(existsSync(`/sys/fs/cgroup${previous.group}`), false, "the old subtree is gone before any checkout runs");
  }
  const replacement = new GateScopes(process.env, receipt);
  try {
    assert.equal(existsSync(`/sys/fs/cgroup${previous.group}`), false, "no stale descendant survives into the replacement run");
  } finally { replacement.close(); }
  assert.equal(existsSync(receipt), false);
});

test("a live runner's root cannot be reaped by another runner in its tree", () => {
  const own = newTestScratch("run-owner-live"), receipt = join(own, "owner.json");
  const owner = new GateScopes(process.env, receipt);
  let unexpected: GateScopes | undefined;
  try {
    assert.throws(() => { unexpected = new GateScopes(process.env, receipt); }, /live gate runner/);
    assert.match(readFileSync(`/sys/fs/cgroup${owner.group}/cgroup.events`, "utf8"), /^populated 0$/m);
  } finally { unexpected?.close(); owner.close(); rmSync(own, { recursive: true, force: true }); }
});
