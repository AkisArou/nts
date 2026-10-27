import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import test from "node:test";
import { spawnTest } from "./test-wait.ts";

const shell = readFileSync(process.env.NTS_TOOLING_LOG_SHELL ?? new URL("./all.sh", import.meta.url), "utf8");
const wrapper = /^tooling_tests\(\) \{\n[\s\S]*?^\}/m.exec(shell)?.[0];
assert.ok(wrapper, "the test exercises all.sh's actual tooling wrapper");
const scratch = join(homedir(), ".cache/nts-scratch/tooling-log");
mkdirSync(scratch, { recursive: true });

function run(t: { after(fn: () => void): void }, failure: boolean, runDirectory: boolean, color: boolean) {
  const root = mkdtempSync(join(scratch, "report-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["bin", "run", "tmp"]) mkdirSync(join(root, dir));
  const fixture = join(root, "fixture.test.ts");
  writeFileSync(fixture, `import test from 'node:test';
import assert from 'node:assert/strict';
test('clean passing control', () => {});
test('known TODO probe', {todo: 'upstream limitation'}, () => assert.fail('known upstream failure'));
test('named skipped probe', {skip: 'device absent'}, () => assert.fail('must not run'));
${failure ? "test('real failure beyond the TODOs', () => assert.fail(Array.from({length: 80}, (_, i) => 'diagnostic line ' + i).join('\\n') + '\\nFINAL_ASSERTION_SENTINEL'));" : ""}
`);
  // Run the real Node reporter on a small fixture, and stub only the unrelated
  // owed self-test. No nested gate runner or shared source tree is executed.
  writeFileSync(join(root, "bin/node"), `#!${process.execPath}
const {spawnSync}=require('node:child_process');
if(process.argv[2]==='--test'){
 const result=spawnSync(process.execPath,['--test',process.env.TEST_FIXTURE],{stdio:'inherit'});
 process.exitCode=result.status??1;
}else if(process.argv[2]!=='tooling/gate/owed.mjs')process.exitCode=99;
`, { mode: 0o755 });
  const script = join(root, "wrapper.sh");
  writeFileSync(script, wrapper + "\ntooling_tests\n");
  const env: NodeJS.ProcessEnv = {
    ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, TMPDIR: join(root, "tmp"),
    NTS_GATE_RUN_DIR: runDirectory ? join(root, "run") : "", TEST_FIXTURE: fixture,
    FORCE_COLOR: color ? "1" : "0",
  };
  // This is an independent reporter fixture, not a worker of this test file.
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_DISABLE_COLORS;
  delete env.NO_COLOR;
  const result = spawnTest("sh", [script], {
    cwd: root, encoding: "utf8", env,
  });
  assert.equal(result.stderr, "");
  const printed = stripVTControlCharacters(result.stdout);
  const path = /^  log: (.+)$/m.exec(printed)?.[1];
  assert.ok(path, "every invocation names its retained raw transcript");
  const raw = stripVTControlCharacters(readFileSync(path, "utf8"));
  if (runDirectory) assert.equal(path, join(root, "run/tooling-tests.raw.log"));
  else assert.ok(path.startsWith(join(root, "tmp/nts-gate-tooling.")));
  return { result, printed, raw };
}

test("a real failure keeps its complete assertion after expected TODOs", t => {
  const { result, printed, raw } = run(t, true, true, false);
  assert.equal(result.status, 1, raw);
  for (const name of ["known TODO probe", "named skipped probe", "real failure beyond the TODOs", "FINAL_ASSERTION_SENTINEL"]) {
    assert.ok(printed.includes(name), name + "\n" + printed);
    assert.ok(raw.includes(name), name);
  }
  for (const count of ["tests 4", "pass 1", "fail 1", "cancelled 0", "skipped 1", "todo 1"]) assert.ok(printed.includes(count), count);
  assert.ok(raw.includes("clean passing control"), "the complete passing output is retained too");
  assert.ok(!printed.includes("clean passing control"), "ordinary passes stay out of the filtered report");
});

for (const color of [false, true]) test(`TODOs and skips preserve exit 0 and their names (${color ? "color" : "plain"})`, t => {
  const { result, printed, raw } = run(t, false, false, color);
  assert.equal(result.status, 0);
  for (const name of ["known TODO probe", "named skipped probe"]) {
    assert.ok(printed.includes(name), name + "\n" + printed);
    assert.ok(raw.includes(name), name);
  }
  for (const count of ["tests 3", "pass 1", "fail 0", "cancelled 0", "skipped 1", "todo 1"]) assert.ok(printed.includes(count), count);
});
