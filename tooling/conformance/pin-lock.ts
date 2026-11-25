// The pin writer and reclaimer share this one mutex, without importing the builder.
import {hostObservations,type HostObservations} from '../gate/host-observations.ts';
import {existsSync,lstatSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

export const PINS = process.env.NTS_PINS ?? join(homedir(), ".cache/nts-pins");
const TREE = join(PINS, "tree");
const LOCK = join(PINS, "build.lock");

const alive = (pid:number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * **One build at a time in the one pin tree.** Every pin shares `TREE` and
 * `TARGET`, and a build checks out, applies, compiles, and checks out again
 * to undo. On 2026-09-29 two pins built minutes apart: one pin's closing
 * checkout reverted the other's patch in the middle of its `cargo build`, and
 * that pin shipped a binary without its patch, beside an `applied.diff` and a
 * provenance record naming it. A provenance record is trusted, so it was the
 * worst failure this tool can have.
 *
 * The lock is a directory, because `mkdir` is atomic, holding the holder's
 * pid. A holder that no longer runs is stale, and so is a lock with no pid
 * file after a minute (a crash between the two writes). A waiter says so once
 * and polls. `lock` and `wait` are parameters for the self-test.
 */
export function withBuildLock<T>(fn:()=>T, { lock = LOCK, wait = 60 * 60 * 1000, host = hostObservations() }:{lock?:string;wait?:number;host?:Pick<HostObservations,'wallNow'>} = {}):T {
  const started = host.wallNow();
  let said = false;
  const nap = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "pid"), String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pidFile = join(lock, "pid");
      const holder = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : 0;
      const orphaned = holder === 0 && host.wallNow() - (lstatSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0) > 60_000;
      if ((holder !== 0 && !alive(holder)) || orphaned) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (host.wallNow() - started >= wait) throw new Error(`the pin tree is held by pid ${holder || "(unknown)"} (${lock}); waited ${Math.round((host.wallNow() - started) / 1000)} s`);
      if (!said) {
        console.error(`  waiting: pin.ts pid ${holder || "(starting)"} is building in ${TREE}`);
        said = true;
      }
      Atomics.wait(nap, 0, 0, 1000);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

