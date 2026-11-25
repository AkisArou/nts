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
 * and polls. Timeouts and pidless grace use the monotonic capability: a fixture
 * freezing that clock must advance it or use wait:0 for contention.
 * `lock` and `wait` are parameters for the self-test.
 */
export function withBuildLock<T>(fn:()=>T, { lock = LOCK, wait = 60 * 60 * 1000, host = hostObservations() }:{lock?:string;wait?:number;host?:Pick<HostObservations,'wallNow'|'now'>} = {}):T {
  const started = host.now();
  let pidless:{identity:string;since:number}|undefined;
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
      const info=lstatSync(lock,{throwIfNoEntry:false});
      if(!info)continue;
      const identity=[info.dev,info.ino,info.mtimeMs,info.ctimeMs].join(':');
      if(holder!==0)pidless=undefined;
      else if(pidless?.identity!==identity)pidless={identity,since:host.now()};
      // The wall clock recognises an old orphan immediately. A monotonic
      // observation also expires an unchanged pidless lock under a fixed wall clock.
      const orphaned=holder===0&&(host.wallNow()-info.mtimeMs>60_000||host.now()-pidless!.since>=60_000);
      if ((holder !== 0 && !alive(holder)) || orphaned) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (host.now() - started >= wait) throw new Error(`the pin tree is held by pid ${holder || "(unknown)"} (${lock}); waited ${Math.round((host.now() - started) / 1000)} s`);
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

