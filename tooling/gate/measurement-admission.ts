// CPU tickets carry queue position, never a memory promise. All ticket changes
// and the nonblocking CPU acquisition run under the memory ledger's flock.
// The directory mutex stays compatible with measurements on older commits.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { LEDGER_DIR, processIdentity, queueOrder, type JointAdmission, type Priority, type ProcessIdentity } from "./memory-ledger.ts";
import { coreTicks, QuietWindow } from "./measurement.ts";

export class MeasurementBusy extends Error { status = 75; }
type Ticket = { id: string; seq: number; priority: Priority; owner: ProcessIdentity };
const live = (owner: ProcessIdentity) => {
  const now = processIdentity(owner.pid);
  return now?.boot === owner.boot && now?.start === owner.start;
};

/** Tickets live with the ledger, on cache disk, while the legacy mutex keeps its shared path. */
export const measurementQueue = (lock: string, ledger = process.env.NTS_MEMORY_LEDGER ?? LEDGER_DIR): string =>
  join(ledger, "measurements", createHash("sha256").update(resolve(lock)).digest("hex"));

export function measurementAdmission(options: { lock: string; priority: Priority; wait: boolean; quiet: boolean; report(line: string): void }):
  JointAdmission & { close(): void } {
  const { lock, priority, report } = options, directory = measurementQueue(lock);
  const owner = processIdentity(process.pid);
  if (!owner) throw new Error("this process has no identity in /proc");
  const id = randomUUID(), file = join(directory, `${id}.json`);
  let ticket: Ticket | undefined, held = false, staleSince: number | undefined;
  let quiet: QuietWindow | undefined, quietFrom = 0, announced = false, queued = false;
  const remove = (file: string) => { try { unlinkSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } };
  const available = () => {
    if (!existsSync(lock)) { staleSince = undefined; return true; }
    let pid: number;
    try { pid = Number(readFileSync(join(lock, "pid"), "utf8").trim()); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; pid = 0; }
    if (Number.isSafeInteger(pid) && pid > 0 && processIdentity(pid) !== null) {
      staleSince = undefined;
      if (!options.wait) throw new MeasurementBusy(`with-lock: pid ${pid} is measuring; not starting another`);
      return false;
    }
    // An older shell writes pid just after mkdir. Give that acquisition a beat.
    staleSince ??= performance.now();
    if (performance.now() - staleSince < 1000) return false;
    report(`with-lock: the lock is stale -- pid ${pid || "none"} is not running`);
    remove(join(lock, "pid"));
    rmdirSync(lock);
    staleSince = undefined;
    return true;
  };
  return {
    ready() {
      mkdirSync(directory, { recursive: true });
      const tickets: Ticket[] = [];
      for (const name of readdirSync(directory).filter(name => name.endsWith(".json"))) {
        const path = join(directory, name);
        let other: Ticket;
        try { other = JSON.parse(readFileSync(path, "utf8")) as Ticket; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        if (live(other.owner)) tickets.push(other); else remove(path);
      }
      if (!ticket) {
        ticket = { id, seq: 1 + Math.max(0, ...tickets.map(other => other.seq)), priority, owner };
        writeFileSync(`${file}.next`, JSON.stringify(ticket), { mode: 0o600 });
        renameSync(`${file}.next`, file);
        tickets.push(ticket);
      }
      const free = available();
      if (tickets.sort(queueOrder)[0]?.id !== id) {
        quiet = undefined;
        if (!options.wait) throw new MeasurementBusy("with-lock: another measurement is ahead in the queue; not starting another");
        if (!queued) { report(`with-lock: queued for CPUs 4-5 (${priority}), holding no memory reservation`); queued = true; }
        return false;
      }
      if (!free) { quiet = undefined; return false; }
      if (!options.quiet || process.platform !== "linux") return true;
      if (!quiet) { quiet = new QuietWindow(); quietFrom = performance.now(); }
      if (!announced) {
        report("with-lock: waiting for CPUs 4-5 to run no other program and stay at least 90% idle on average for 45 s (limit 180 s)");
        announced = true;
      }
      if (quiet.sample(performance.now(), coreTicks(readFileSync("/proc/stat", "utf8")))) return true;
      if (performance.now() - quietFrom >= 180000) throw new MeasurementBusy("with-lock: CPUs 4-5 did not become quiet; not starting a run");
      return false;
    },
    acquire() {
      mkdirSync(dirname(lock), { recursive: true });
      try { mkdirSync(lock); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
      held = true;
      writeFileSync(join(lock, "pid"), `${process.pid}\n`);
      remove(file);
      remove(`${file}.next`);
      return true;
    },
    close() {
      remove(file);
      remove(`${file}.next`);
      if (held) { held = false; remove(join(lock, "pid")); rmdirSync(lock); }
    },
  };
}
