// An owner lock: a file naming the process that holds it, by boot, pid and
// start time, so a lock whose owner is gone -- killed, crashed, or a pid the
// kernel reused -- is taken over rather than waited on forever.
import { closeSync, openSync, readFileSync, readdirSync, linkSync, unlinkSync, writeFileSync } from "node:fs";
import {randomUUID} from 'node:crypto';
import {basename,dirname,join} from 'node:path';
import {infrastructureProbe} from '../gate/infrastructure-probe.ts';

export function processIdentity(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (fields[0] === "Z" || fields[0] === "X") return null;
    return `${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()} ${pid} ${fields[19]}`;
  } catch { return null; }
}

export type Lock = { path: string; owner: string; release: () => void };

type Owner={text:string;pid:number};
function readOwner(path:string):Owner|undefined{
  let bytes:Buffer;
  try{bytes=readFileSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  const text=bytes.toString('utf8').trim();
  const match=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} ([1-9][0-9]*) [0-9]+$/.exec(text);
  const pid=Number(match?.[1]);
  if(!match||!Number.isSafeInteger(pid)||!Buffer.from(bytes.toString('utf8')).equals(bytes))throw Error(`owner lock ${path} has malformed owner bytes ${JSON.stringify(bytes.toString('utf8'))} (hex ${bytes.toString('hex')}); confirm that no process named in these bytes is alive, then remove this file`);
  return {text,pid};
}

/** Only dead-owner reclamation needs a kernel lock. It is never held across
 * the caller's work, and the sibling inode is never unlinked. Every reclaimer
 * rereads under it: a stale observation cannot unlink a replacement owner. */
function deadTemporaries(path:string):string[]{
  const prefix=basename(path)+'.';
  return readdirSync(dirname(path),{withFileTypes:true}).flatMap(entry=>{
    if(!entry.isFile()||!entry.name.startsWith(prefix))return [];
    const match=/^([1-9][0-9]*)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.exec(entry.name.slice(prefix.length));
    const pid=Number(match?.[1]);
    // A reused PID delays cleanup. An unpublished candidate has no birth
    // identity, so a live process with that PID is always protected.
    return match&&Number.isSafeInteger(pid)&&!processIdentity(pid)?[join(dirname(path),entry.name)]:[];
  });
}
function reclaim(path:string,observed?:Owner):void{
  const fd=openSync(path+'.reclaim','a',0o600);
  try{
    // flock locks the shared open file description. This parent retains it
    // after the helper exits, and closes it before returning to the caller.
    const result=infrastructureProbe({purpose:'reclaim dead owner lock '+path,command:'flock',args:['-n','-E','75','3'],
      stdio:['ignore','ignore','pipe',fd],exits:[0,75]});
    if(result.status===75)return;
    const current=readOwner(path);
    if(observed&&current?.text===observed.text&&processIdentity(current.pid)!==current.text)unlinkSync(path);
    for(const temporary of deadTemporaries(path))unlinkSync(temporary);
  }finally{closeSync(fd);}
}

/** The lock at `path` for this process, or null while a live process holds it. */
export function acquire(path: string): Lock | null {
  const owner = processIdentity(process.pid);
  if (!owner) throw new Error("this process has no identity in /proc");
  // A crash before publication leaves no public owner to reclaim. The next
  // acquirer also visits orphan candidates, under the same short flock.
  if(deadTemporaries(path).length)reclaim(path);
  const temporary=`${path}.${process.pid}.${randomUUID()}`;
  const fd=openSync(temporary,'wx',0o600);
  try{
    try{writeFileSync(fd,`${owner}\n`);}finally{closeSync(fd);}
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Publish complete immutable bytes, never an empty wx file.
        linkSync(temporary, path);
        let released=false;
        return {path,owner,release:()=>{
          if(released)return;
          if(readOwner(path)?.text===owner)unlinkSync(path);
          released=true;
        }};
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const held=readOwner(path);if(!held)continue;
        if(processIdentity(held.pid)===held.text)return null;
        reclaim(path,held);
      }
    }
    return null;
  }finally{unlinkSync(temporary);}
}

/** Who holds the lock at `path`, when a live process does. */
export function holder(path: string): number | null {
  const held=readOwner(path);
  return held&&processIdentity(held.pid)===held.text?held.pid:null;
}

const pause = new Int32Array(new SharedArrayBuffer(4));
/** Run `body` holding the lock at `path`, waiting for it up to `waitMs`. */
export function withLock<T>(path: string, body: () => T, waitMs = 30_000): T {
  const until = Date.now() + waitMs;
  for (;;) {
    const lock = acquire(path);
    if (lock) { try { return body(); } finally { lock.release(); } }
    if (Date.now() > until) throw new Error(`${path} is held by process ${holder(path) ?? "?"}`);
    Atomics.wait(pause, 0, 0, 50);
  }
}
