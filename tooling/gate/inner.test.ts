import {testEnvironment} from "./test-environment.ts";
// The inner loop's decisions: which crates a change touches, when reference
// counting is owed, which runtime C is formatted, and which CPUs heavy work
// may use.
//
//   node --test tooling/gate/inner.test.ts
//
// **The paths below name nothing in this repository on purpose.** The gate
// reads every file a step runs for the paths it names (`owed.mjs`,
// `stepInputs`), and this file is one of the `tooling` step's: a real
// directory written here, `compiler/codegen/c` say, made every change to that
// crate owe the `tooling` step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpusOffMeasurement, cratesTouched, formattedRuntimeC, reachesCounting } from "./inner.ts";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { copyModuleClosure } from "./module-closure-fixture.ts";
import { gateEnvironment, hostEnvironment } from "./canonical-environment.ts";
import { ownMemory } from "./test-memory.ts";
import { newTestScratch } from "./test-scratch.ts";
import { removable } from "./run-temporary.ts";
import { newToolingSlice, stopToolingSlice, toolingSliceArgs } from "./tooling-slice.ts";

const PACKAGES = [
  { name: "alpha", dir: "compiler/sample-alpha" },
  { name: "alpha-backend", dir: "compiler/sample-alpha/backend" },
  { name: "beta", dir: "tooling/sample-beta" },
];

test("a path belongs to the package whose directory is its longest prefix", () => {
  assert.deepEqual(
    cratesTouched(["compiler/sample-alpha/backend/src/x.rs", "compiler/sample-alpha/src/y.rs"], PACKAGES),
    ["alpha", "alpha-backend"],
  );
});

test("a directory name that only starts like a package's is not in it", () => {
  // `compiler/sample-alpha-extra` is not `compiler/sample-alpha`.
  assert.deepEqual(cratesTouched(["compiler/sample-alpha-extra/lib.rs"], PACKAGES), []);
});

test("a fixture, a doc or a script touches no crate", () => {
  assert.deepEqual(cratesTouched(["tests/sample/src/main.ts", "docs/sample.md"], PACKAGES), []);
});

test("reference counting is owed by the compiler and the runtimes, not by tests alone", () => {
  assert.equal(reachesCounting(["compiler/sample-alpha/src/y.rs"]), true);
  assert.equal(reachesCounting(["runtime/sample.c"]), true);
  assert.equal(reachesCounting(["tests/sample/expected", "tooling/sample-beta/x.ts"]), false);
});

test("heavy work runs everywhere but CPUs 4 and 5", () => {
  assert.equal(cpusOffMeasurement(8), "0,1,2,3,6,7");
  assert.equal(cpusOffMeasurement(4), "0,1,2,3");
});

test("runtime C is formatted at the top level and in tests/, never in a vendored tree", () => {
  assert.deepEqual(
    formattedRuntimeC([
      "runtime/c/sample.c",
      "runtime/c/tests/sample.c",
      "runtime/c/vendored/sample.c",
      "runtime/c/sample.h",
      "runtime/c/sample.md",
    ]),
    ["runtime/c/sample.c", "runtime/c/tests/sample.c", "runtime/c/sample.h"],
  );
});

for (const [initial, fails, keepGoing] of [["stale", false, false], ["fresh", false, false], ["stale", true, false], ["stale", true, true]] as const) {
  test(`--no-agree builds before tests: ${initial}, build fails=${fails}, keep-going=${keepGoing}`, t => {
    const root = newTestScratch("inner-compiler"), tree = join(root, "tree"), bin = join(root, "bin");
    const unit = `nts-test-inner-compiler-${randomUUID()}`, slice = newToolingSlice(true);
    t.after(() => {
      spawnSync("systemctl", ["--user", "stop", unit], {env:testEnvironment(), stdio: "ignore" });
      stopToolingSlice(slice);
      removable(root); rmSync(root, { recursive: true, force: true });
    });
    copyModuleClosure(["tooling/gate/inner.ts"], tree);
    // Package inputs are explicit; the copied module graph has no install.
    mkdirSync(join(root, "node_modules"));
    symlinkSync(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), join(root, "node_modules/typescript"));
    copyFileSync(new URL("../differential/oracle-toolchain.json", import.meta.url), join(tree, "tooling/differential/oracle-toolchain.json"));
    const script = join(tree, "tooling/gate/inner.ts");
    // Route the CLI's run storage into this fixture; its control flow is exact.
    writeFileSync(script, readFileSync(script, "utf8").replace("homedir()", JSON.stringify(join(root, "home"))));
    writeFileSync(join(tree, ".tool-versions"), `nodejs ${process.versions.node}\n`);
    mkdirSync(bin);
    const compiler = join(tree, "target/nts-dev/nts"), calls = join(root, "cargo.jsonl");
    mkdirSync(dirname(compiler), { recursive: true });
    const executable = (value: string) => `#!${process.execPath}\nconsole.log(${JSON.stringify(value)});\n`;
    writeFileSync(compiler, executable(initial), { mode: 0o755 });
    utimesSync(compiler, 1, 1);
    writeFileSync(join(tree, ".gitignore"), "target/\n");
    writeFileSync(join(bin, "cargo"), `#!${process.execPath}
import {appendFileSync,writeFileSync,readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2);appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args)+'\\n');
if(args[0]==='metadata') console.log(JSON.stringify({packages:[]}));
if(args[0]==='build') {
  if(${fails}) process.exit(23);
  if(!readFileSync(${JSON.stringify(compiler)},'utf8').includes('fresh')) writeFileSync(${JSON.stringify(compiler)},${JSON.stringify(executable("fresh"))},{mode:0o755});
}
if(args[0]==='test') {
  if(process.env.NTS_BIN!==${JSON.stringify(compiler)}||process.env.NTS_CHECKERS!=='1') process.exit(24);
  const ran=spawnSync(process.env.NTS_BIN,[],{encoding:'utf8'}); if(ran.status!==0||ran.stdout.trim()!=='fresh') process.exit(25);
}
`, { mode: 0o755 });
    // The real admission runner is not under test. Its private stand-in runs
    // only fake cargo, while the real inner CLI builds its normal commands.
    writeFileSync(join(tree, "tooling/gate/admit.ts"), `import {spawnSync} from 'node:child_process';
const args=process.argv.slice(2),command=args.slice(args.indexOf('--')+1);
process.exit(spawnSync(command[0],command.slice(1),{stdio:'inherit'}).status??1);
`);
    for (const args of [["init", "-q", "-b", "main"], ["add", "."], ["-c", "user.name=inner-test", "-c", "user.email=inner@example.invalid", "commit", "-qm", "fixture"]]) {
      const ran = spawnSync("git", args, {env:testEnvironment(), cwd: tree, encoding: "utf8" }); assert.equal(ran.status, 0, ran.stderr);
    }
    const memory = ownMemory(join(root, "memory"));
    const env = gateEnvironment({ ...hostEnvironment(process.env), PATH: bin + ":" + process.env.PATH },
      { run: join(root, "run"), owned: { ...memory, NTS_TOOLING_SLICE: slice }, standalone: true }).env;
    const setenv = Object.entries(env).filter((entry): entry is [string,string] => entry[1] !== undefined).map(([key,value]) => `--setenv=${key}=${value}`);
    const ran = spawnSync("systemd-run", ["--user", ...toolingSliceArgs(env), `--unit=${unit}`, "--collect", "--wait", "--pipe", "--quiet",
      "--property=RuntimeMaxSec=300s", "--property=Nice=19", "--property=LimitCORE=0", "--property=CPUAffinity=0-3 6-31",
      ...setenv, process.execPath, script, "--no-agree", ...(keepGoing ? ["--keep-going"] : [])], {env:testEnvironment(), encoding: "utf8" });
    assert.equal(ran.status, fails ? 1 : 0, ran.stdout + ran.stderr);
    assert.ok(existsSync(calls), ran.stdout + ran.stderr);
    const phases = readFileSync(calls, "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]);
    const build = phases.findIndex(args => args[0] === "build"), tests = phases.findIndex(args => args[0] === "test");
    assert.ok(build >= 0, ran.stdout + ran.stderr);
    assert.deepEqual(phases[build], ["build", "--profile", "nts-dev", "-p", "nts-cli"]);
    if (fails) assert.equal(tests, -1, "a failed build must never test its stale compiler, even with --keep-going");
    else assert.ok(tests > build, "both stale and fresh controls test only after a successful compiler build");
  });
}
