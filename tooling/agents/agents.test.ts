import {testEnvironment} from "../gate/test-environment.ts";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { OOM_SCORE } from "../gate/memory-ledger.ts";
import { newTestScratch } from "../gate/test-scratch.ts";
import { ownMemoryEnv } from "../gate/test-memory.ts";
import { spawnTest, waitFor } from "../gate/test-wait.ts";
import { AGENT_CPUS, agentUnit, parseAgents, parseCommand, startArgs } from "./agents.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCHER = join(HERE, "agents.ts");

test("an agent's name is its unit, and only a unit-safe name names one", () => {
  assert.equal(agentUnit("worker-1"), "nts-agent-worker-1.service");
  for (const bad of ["", "-x", ".x", "a/b", "a@b", "a b", "a:b"]) assert.throws(() => agentUnit(bad), /invalid agent name/, bad);
});

test("commands parse as start's name and argv, one stop name, and list's json", () => {
  assert.deepEqual(parseCommand(["start", "--name", "w1", "--", "cmd", "--flag"]), { kind: "start", name: "w1", argv: ["cmd", "--flag"] });
  assert.deepEqual(parseCommand(["start", "--name=w1", "--", "cmd"]), { kind: "start", name: "w1", argv: ["cmd"] });
  assert.deepEqual(parseCommand(["stop", "w1"]), { kind: "stop", name: "w1" });
  assert.deepEqual(parseCommand(["list"]), { kind: "list", json: false });
  assert.deepEqual(parseCommand(["list", "--json"]), { kind: "list", json: true });
  for (const argv of [[], ["start"], ["start", "--name", "w1"], ["start", "--name", "w1", "--"], ["start", "w1", "--", "cmd"], ["stop"], ["stop", "a", "b"], ["list", "--yaml"], ["restart"]]) {
    assert.throws(() => parseCommand(argv), /usage:/, argv.join(" "));
  }
});

test("start names its own collected unit, off the measurement CPUs, at an agent's priority", () => {
  const args = startArgs("w1", ["run", "this"], { PATH: "/usr/bin", HOME: "/home/u" }, "/work");
  const joined = args.join(" ");
  assert.ok(args.includes("--unit=nts-agent-w1.service"), joined);
  assert.ok(args.includes("--collect"), joined);
  assert.ok(args.includes("LimitCORE=0"), joined);
  assert.ok(args.includes("Nice=19"), joined);
  assert.ok(args.includes(`OOMScoreAdjust=${OOM_SCORE.agent}`), joined);
  assert.equal(OOM_SCORE.agent, 300);
  assert.ok(args.includes(`CPUAffinity=${AGENT_CPUS}`), joined);
  assert.equal(AGENT_CPUS, "0-3 6-31", "CPUs 4-5 stay reserved for measurement");
  assert.ok(args.includes("--working-directory=/work"), joined);
  assert.deepEqual(args.slice(args.indexOf("--") + 1), ["run", "this"]);
});

test("the list reading is the loaded nts-agent services, by name", () => {
  const json = JSON.stringify([
    { unit: "nts-agent-beta.service", active: "active", sub: "running" },
    { unit: "nts-full-check.service", active: "active", sub: "running" },
    { unit: "nts-agent-alpha.service", active: "inactive", sub: "dead" },
    { unit: "other.service", active: "active", sub: "running" },
  ]);
  assert.deepEqual(parseAgents(json), [
    { name: "alpha", unit: "nts-agent-alpha.service", active: "inactive", sub: "dead" },
    { name: "beta", unit: "nts-agent-beta.service", active: "active", sub: "running" },
  ]);
});

// The real unit, under a name of this test's own, with a memory reading and
// ledger of the test's own (AGENTS.md): started, listed as another tool
// reads it, and stopped by name -- nothing else.
test("an agent starts in its own unit, lists, and stops by name", async t => {
  const directory = newTestScratch("agent-launcher");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const name = `test596-${process.pid}`;
  const unit = agentUnit(name);
  const env = ownMemoryEnv(join(directory, "memory"), { ...testEnvironment(), TMPDIR: directory });
  const run = (...args: string[]) => spawnTest(process.execPath, [LAUNCHER, ...args], { encoding: "utf8", env }, `agents ${args[0]}`);
  const ctl = (...args: string[]) => spawnTest("systemctl", ["--user", ...args], { encoding: "utf8" });
  const show = (property: string) => ctl("show", unit, `--property=${property}`, "--value").stdout.trim();
  t.after(() => { try { ctl("stop", unit); } catch { /* already gone */ } });

  const started = run("start", "--name", name, "--", "tail", "-f", "/dev/null");
  assert.equal(started.status, 0, started.stderr);
  assert.equal(started.stdout.trim(), `started ${unit}`);
  await waitFor("the agent's unit active", () => show("ActiveState") === "active");

  assert.equal(show("Nice"), "19");
  assert.equal(show("OOMScoreAdjust"), String(OOM_SCORE.agent));
  assert.equal(show("LimitCORE"), "0");
  const pid = show("MainPID");
  assert.match(readFileSync(`/proc/${pid}/status`, "utf8"), /^Cpus_allowed_list:\t0-3,6-31$/m);

  const listed = JSON.parse(run("list", "--json").stdout) as { name: string; unit: string; active: string; sub: string }[];
  assert.deepEqual(listed.filter(agent => agent.name === name), [{ name, unit, active: "active", sub: "running" }]);

  const again = run("start", "--name", name, "--", "tail", "-f", "/dev/null");
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already running/);

  const stopped = run("stop", name);
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.equal(stopped.stdout.trim(), `stopped ${unit}`);
  const listedAfter = JSON.parse(run("list", "--json").stdout) as { name: string }[];
  assert.ok(!listedAfter.some(agent => agent.name === name), "the stopped agent is not listed");

  const missing = run("stop", name);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no agent/);
});
