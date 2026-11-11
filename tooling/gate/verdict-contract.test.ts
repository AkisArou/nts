import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contractIdentity, validContract, verdictContract } from "./verdict-contract.ts";
import { contractReport, fixtureContract } from "./verdict-contract-fixture.ts";
import { gateEnvironment } from "./canonical-environment.ts";
import { fixtureEnvironment } from "./test-environment.ts";
import { newTestScratch } from "./test-scratch.ts";
import { ownMemory } from "./test-memory.ts";
import { removable } from "./run-temporary.ts";
import { toolchainDirectories } from "./toolchain.ts";
import { launcherEnvironment } from "../landing/run.ts";

test("the portable contract removes run allocation while retaining program-visible capabilities", () => {
  const report = contractReport(), first = fixtureContract();
  report.host.DBUS_SESSION_BUS_ADDRESS = "other-bus";
  report.host.XDG_RUNTIME_DIR = "/other/runtime";
  report.host.PATH = "/fixture/bin:/fixture/bin";
  report.ambient.TMPDIR = "/other/run/tmp";
  report.ambient.NODE_COMPILE_CACHE = "/other/cache";
  report.ambient.XDG_CACHE_HOME = "/other/cache";
  const facts = first.environment;
  assert.deepEqual(verdictContract(report, facts), first);
  report.host.JAVA_HOME = "/other/jdk";
  assert.notEqual(verdictContract(report, facts).identity, first.identity);
});

test("oracle contracts retain input and producer identities across independent captures", () => {
  const report = contractReport(), facts = fixtureContract().environment;
  const capability = {
    version: 1, sourceRevision: "a".repeat(40), lockfileSha256: "lock", helperSha256: "helper", producerSha256: "producer",
    source: "/landing/tree", directory: "/landing/run/capture", admission: { kind: "gate", token: "first" },
    ownerStep: null, seal: { record: "/landing/seal", nodeVersion: "26.13.0" },
  };
  report.host.NTS_ORACLE_DEPENDENCIES = JSON.stringify(capability);
  report.host.NTS_ORACLE_TYPESCRIPT = "/landing/tree/node_modules/typescript";
  const first = verdictContract(report, facts);
  report.host.NTS_ORACLE_DEPENDENCIES = JSON.stringify({
    ...capability, source: "/core/tree", directory: "/core/run/capture", ownerStep: "tests",
    admission: { kind: "gate", token: "second" }, seal: { record: "/core/seal", nodeVersion: "26.13.0" },
  });
  report.host.NTS_ORACLE_TYPESCRIPT = "/core/tree/node_modules/typescript";
  assert.deepEqual(verdictContract(report, facts), first);
  report.host.NTS_ORACLE_DEPENDENCIES = JSON.stringify({ ...capability, producerSha256: "changed" });
  assert.notEqual(verdictContract(report, facts).identity, first.identity);
});

test("canonical policy, runtime, tools and inputs determine the contract", () => {
  const report = contractReport(), first = fixtureContract(), facts = first.environment;
  assert.equal(validContract(first), true);
  assert.equal(validContract({ ...first, identity: "wrong" }), false);
  assert.equal(validContract({ version: 1, identity: "", environment: {} }), false);
  const reordered = { ...facts, host: Object.fromEntries(Object.entries(facts.host).reverse()) };
  assert.equal(contractIdentity(reordered), first.identity);
  for (const change of [{ node: "27.0.0" }, { tools: { rustc: "changed" } }, { inputs: { lock: "changed" } }, { platform: "darwin" }]) {
    assert.notEqual(verdictContract(report, { ...facts, ...change }).identity, first.identity);
  }
  report.canonical = false;
  assert.throws(() => verdictContract(report, facts), /canonical/);
  report.canonical = true;
  report.experiments.push({ name: "NTS_BIN", value: "override" });
  assert.throws(() => verdictContract(report, facts), /experiments/);
});

test("contract identity uses stable key ordering independently of the reader's locale", () => {
  const contract = fixtureContract(), compare = String.prototype.localeCompare;
  try {
    String.prototype.localeCompare = () => { throw Error("locale collation was consulted"); };
    assert.equal(contractIdentity(contract.environment), contract.identity);
  } finally { String.prototype.localeCompare = compare; }
});

test("different launcher paths produce the same canonical PATH and verdict contract", t => {
  const run = newTestScratch("verdict-canonical-path");
  t.after(() => { removable(run); rmSync(run, { recursive: true, force: true }); });
  const base = fixtureEnvironment(t), owned = ownMemory(join(run, "memory"));
  const agent = join(run, "agent-tools");
  mkdirSync(agent);
  writeFileSync(join(agent, "only-launcher-tool"), "#!/bin/sh\nexit 41\n", { mode: 0o755 });
  const first = gateEnvironment({ ...base, PATH: agent + delimiter + "/usr/bin" }, { run: join(run, "first"), owned });
  const second = gateEnvironment({ ...base, PATH: "/bin" + delimiter + join(run, "other-agent") }, { run: join(run, "second"), owned });
  assert.equal(first.env.PATH, second.env.PATH);
  assert.deepEqual(first.env.PATH!.split(delimiter).slice(0, toolchainDirectories(process.execPath, base).length),
    toolchainDirectories(process.execPath, base));
  assert.equal(first.env.PATH!.split(delimiter).includes(agent), false);
  const facts = fixtureContract().environment;
  assert.deepEqual(verdictContract(first.report, facts), verdictContract(second.report, facts));
  const missing = spawnSync("only-launcher-tool", [], { env: first.env, encoding: "utf8" });
  const missingError: NodeJS.ErrnoException | undefined = missing.error;
  assert.equal(missingError?.code, "ENOENT");
  assert.match(missingError?.message ?? "", /only-launcher-tool/);
  const inherited = gateEnvironment({ ...first.env, PATH: agent }, { run: join(run, "inherited") });
  assert.equal(inherited.env.PATH, first.env.PATH);
  const fixturePath = agent + delimiter + first.env.PATH;
  const fixtureTools = gateEnvironment(base, { run: join(run, "fixture-tools"), owned: { ...owned, PATH: fixturePath } });
  assert.equal(spawnSync("only-launcher-tool", [], { env: fixtureTools.env }).status, 41);
  const fixtureChild = gateEnvironment(fixtureTools.env, { run: join(run, "fixture-child") });
  assert.equal(fixtureChild.env.PATH, fixturePath);
});

test("constructor Git observations use the canonical PATH in both launcher processes", t => {
  const run = newTestScratch("verdict-constructor-path");
  t.after(() => { removable(run); rmSync(run, { recursive: true, force: true }); });
  const base = launcherEnvironment(fixtureEnvironment(t)), owned = ownMemory(join(run, "memory"));
  const source = fileURLToPath(new URL("../../", import.meta.url));
  const script = `import {gateEnvironment} from ${JSON.stringify(new URL("./canonical-environment.ts", import.meta.url).href)};
import {verdictContract} from ${JSON.stringify(new URL("./verdict-contract.ts", import.meta.url).href)};
const planned=gateEnvironment(process.env,{run:process.argv[1],owned:JSON.parse(process.argv[2])});
const capability=JSON.parse(planned.report.host.NTS_ORACLE_DEPENDENCIES);
process.stdout.write(JSON.stringify({revision:capability.sourceRevision,path:planned.env.PATH,contract:verdictContract(planned.report,${JSON.stringify(fixtureContract().environment)}).identity}));`;
  const launch = (name: string) => {
    const directory = join(run, name);
    mkdirSync(directory);
    writeFileSync(join(directory, "git"), "#!/bin/sh\nprintf " + name + "\n", { mode: 0o755 });
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, join(run, name + "-run"), JSON.stringify(owned)], {
      cwd: source, env: { ...base, PATH: directory + delimiter + "/usr/bin" }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  };
  const first = launch("first-agent"), second = launch("second-agent");
  assert.deepEqual(first, second);
  assert.match(first.revision, /^[a-f0-9]{40}$/);
});
