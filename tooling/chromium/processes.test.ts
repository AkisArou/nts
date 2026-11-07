import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { processType, scopeProcesses } from "./processes.ts";
import { newTestScratch } from "../gate/test-scratch.ts";

const executable = "/engine/nts_shell";
test("Chromium's packed process title and ordinary argv have the same type", () => {
  for (const type of ["renderer", "zygote", "gpu-process", "utility"]) {
    assert.equal(processType(`${executable}\0--type=${type}\0--foo=bar\0`, executable), type);
    assert.equal(processType(`${executable} --type=${type} --foo=bar\0`, executable), type);
  }
  assert.equal(processType(`${executable} --foo=bar\0`, executable), "browser");
  assert.equal(processType(`${executable}-other --type=renderer\0`, executable), "launcher");
  assert.equal(processType(`/bin/sh\0${executable}\0--type=renderer\0`, executable), "launcher");
});

test("scope membership includes reparented processes and excludes another launch", async () => {
  const directory = newTestScratch("chromium-scope");
  const proc = join(directory, "proc"), scope = join(directory, "own.scope");
  const fixtureProcess = async (pid: number, type: string, parent: number) => {
    const path = join(proc, String(pid));
    await mkdir(join(path, "task", String(pid)), { recursive: true });
    await writeFile(join(path, "cmdline"), `${executable} --type=${type}\0`);
    await writeFile(join(path, "status"), `Name:\tnts_shell\nPPid:\t${parent}\nNSpid:\t${pid}\t1\n`);
    await writeFile(join(path, "cgroup"), "0::/own.scope\n");
  };
  try {
    await mkdir(scope, { recursive: true });
    await writeFile(join(scope, "cgroup.procs"), "100\n200\n300\n100\n");
    await fixtureProcess(100, "zygote", 42);
    await fixtureProcess(200, "renderer", 42); // reparented to the user manager
    // 300 exited before its /proc files were read.
    await fixtureProcess(400, "renderer", 100); // same executable, outside this scope
    const own = await scopeProcesses("/own.scope", executable, proc, directory);
    assert.deepEqual(own.map(record => [record.pid, record.type, record.status.PPid]), [[100, "zygote", "42"], [200, "renderer", "42"]]);
    await writeFile(join(proc, "200", "cgroup"), "0::/another.scope\n");
    await assert.rejects(scopeProcesses("/own.scope", executable, proc, directory), /Launch process 200 moved out/);
    await writeFile(join(scope, "cgroup.procs"), "1\n");
    await assert.rejects(scopeProcesses("/own.scope", executable, proc, directory), /never admit PID 1/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
