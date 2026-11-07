// The dex step's compile is bounded per target (tooling/android/dexes.sh, under
// tooling/gate/case-bound.ts): a target whose emit-jvm runs past its bound timed
// out, is named and counted, fails the step as a decline does, and the next
// target runs. On 2026-11-07 one benchmark port compiled for 4.6 hours here.
//
//   node --test tooling/gate/dex-bound.test.ts
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnTest } from "./test-wait.ts";
import { testScratch } from "./test-scratch.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("a target past its compile bound timed out: named, counted, red, and the next target runs", t => {
  const own = testScratch(t, "dex-bound");
  const root = join(own, "repo");
  for (const dir of ["tooling/android", "tooling/gate", "runtime/jvm", "benchmarks/cases/a-spin", "benchmarks/cases/b-declines", "bin", "sdk/build-tools/99.0.0"].map(d => join(d.startsWith("bin") || d.startsWith("sdk") ? own : root, d))) {
    mkdirSync(dir, { recursive: true });
  }
  copyFileSync(join(ROOT, "tooling/android/dexes.sh"), join(root, "tooling/android/dexes.sh"));
  copyFileSync(join(ROOT, "runtime/jvm/test-vm-flags.txt"), join(root, "runtime/jvm/test-vm-flags.txt"));
  // Copies, not links: a tool's main-module guard compares its own path.
  for (const name of ["case-bound.ts", "active-command.ts", "step-result.ts"]) copyFileSync(join(ROOT, "tooling/gate", name), join(root, "tooling/gate", name));
  writeFileSync(join(root, "tooling/gate/token.sh"), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
  writeFileSync(join(own, "sdk/build-tools/99.0.0/d8"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  // The compiler spins on one target and declines the other.
  const nts = join(own, "bin/nts");
  writeFileSync(nts, '#!/bin/sh\ncase "$2" in *a-spin*) while :; do :; done ;; esac\necho "error: the backend declines this program" >&2\nexit 1\n', { mode: 0o755 });
  // The real supervisor, with the compile bound it was asked for made small.
  const preload = join(own, "compile-bound.mjs"), active = pathToFileURL(join(root, "tooling/gate/active-command.ts")).href;
  writeFileSync(preload, `import {mock} from 'node:test';const real=await import(${JSON.stringify(active)});mock.module(${JSON.stringify(active)},{namedExports:{...real,activeCommand:(command,args,options)=>real.activeCommand(command,args,{...options,...(options.ownCpuSeconds?{ownCpuSeconds:0.5}:{}),pollMs:50})}});\n`);
  writeFileSync(join(own, "bin/node"), `#!/bin/sh\nexec '${process.execPath}' --no-warnings --experimental-test-module-mocks --import '${preload}' "$@"\n`, { mode: 0o755 });
  const frame = join(own, "result.json");
  const result = spawnTest("sh", [join(root, "tooling/android/dexes.sh"), "a-spin", "b-declines"], { cwd: root, encoding: "utf8", env: {
    ...process.env, PATH: `${join(own, "bin")}:${process.env.PATH}`, NTS_BIN: nts, ANDROID_HOME: join(own, "sdk"), NTS_GATE_JOBS: "1",
    NTS_ART_WORK: join(own, "work"), NTS_GATE_STEP: "dex", NTS_GATE_STEP_ATTEMPT: "bound", NTS_GATE_STEP_RESULT: frame,
  } });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /^a-spin +emit-jvm timed out: .*used its 0\.5 s CPU bound/m);
  assert.match(result.stdout, /^b-declines +the backend declined it: error: the backend declines this program$/m, "the next target ran");
  assert.match(result.stdout, /^0 dexed, 0 refused, 1 declined by the backend, 1 timed out compiling$/m);
  assert.match(result.stderr, /1 target\(s\) timed out compiling, each named above/);
  assert.equal(existsSync(frame), false, "a timeout is the target's outcome: nothing holds the step");
});
