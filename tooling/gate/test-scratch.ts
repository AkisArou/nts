// Test infrastructure only: where a test keeps its scratch. A test gets a
// fresh folder and the folder goes when the test ends; no test picks a
// ~/.cache root of its own (docs/plan.md, Tooling: every tool's scratch lives
// under the run's TMPDIR).
//
// The folder is under TMPDIR when that is on the cache disk, as the gate's
// canonical environment makes it: inside the run, so what a stopped run leaves
// goes with the run. A test run by hand without one uses ~/.cache/nts/tests,
// never /tmp's tmpfs (AGENTS.md, The machine), and the hourly count names
// what a stopped test left there.
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export const TEST_SCRATCH_ROOT = join(homedir(), ".cache/nts/tests");

/** The folder tests' scratch goes under: TMPDIR when it is inside ~/.cache, else TEST_SCRATCH_ROOT. */
export function testScratchBase(env: NodeJS.ProcessEnv = process.env): string {
  const tmp = env.TMPDIR ? resolve(env.TMPDIR) : null;
  const under = tmp === null ? null : relative(join(homedir(), ".cache"), tmp);
  return under && !under.startsWith("..") && !isAbsolute(under) ? tmp! : TEST_SCRATCH_ROOT;
}

/** A fresh folder `<name>-XXXXXX` for one test; the caller removes it. */
export function newTestScratch(name: string): string {
  const base = testScratchBase();
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, `${name}-`));
}

/** A fresh folder `<name>-XXXXXX`, removed when test `t` ends. */
export function testScratch(t: { after(fn: () => void): void }, name: string): string {
  const dir = newTestScratch(name);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A test binary owns its namespace. Its guard normally empties it; the parent
// reports and removes anything a panic, abort or killed child left behind.



export class TestScratch {
  readonly path:string;
  constructor(parent:string,binary:string) {
    mkdirSync(parent,{recursive:true});
    this.path=mkdtempSync(join(parent,`${basename(binary).replace(/[^a-zA-Z0-9_-]/g,'_')}-`));
  }
  environment(env:NodeJS.ProcessEnv):NodeJS.ProcessEnv {
    return {...env,NTS_TEST_SCRATCH_ROOT:this.path};
  }
  finish():string[] {
    try {
      return readdirSync(this.path).sort().map(name=>join(this.path,name));
    } finally {
      rmSync(this.path,{recursive:true,force:true});
    }
  }
}

/** Direct compile-time scratch would bypass the runner's private namespace. */
export function bypassesScratchOwner(source:string):boolean {
  return /\b(?:option_)?env!\s*\(\s*"CARGO_TARGET_TMPDIR"/.test(source);
}
