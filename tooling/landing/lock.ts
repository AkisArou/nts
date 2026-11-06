// An owner lock: a file naming the process that holds it, by boot, pid and
// start time, so a lock whose owner is gone -- killed, crashed, or a pid the
// kernel reused -- is taken over rather than waited on forever.
import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";

function identity(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (fields[0] === "Z" || fields[0] === "X") return null;
    return `${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()} ${pid} ${fields[19]}`;
  } catch { return null; }
}

export type Lock = { path: string; owner: string; release: () => void };

/** The lock at `path` for this process, or null while a live process holds it. */
export function acquire(path: string): Lock | null {
  const owner = identity(process.pid);
  if (!owner) throw new Error("this process has no identity in /proc");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(path, "wx", 0o600);
      try { writeSync(fd, `${owner}\n`); } finally { closeSync(fd); }
      return { path, owner, release: () => { try { if (readFileSync(path, "utf8").trim() === owner) rmSync(path, { force: true }); } catch { /* already gone */ } } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let held = "";
      try { held = readFileSync(path, "utf8").trim(); } catch { continue; }
      const pid = Number(held.split(" ")[1]);
      if (Number.isSafeInteger(pid) && pid > 0 && identity(pid) === held) return null;
      rmSync(path, { force: true }); // its owner is gone
    }
  }
  return null;
}

/** Who holds the lock at `path`, when a live process does. */
export function holder(path: string): number | null {
  try {
    const held = readFileSync(path, "utf8").trim();
    const pid = Number(held.split(" ")[1]);
    return Number.isSafeInteger(pid) && identity(pid) === held ? pid : null;
  } catch { return null; }
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
