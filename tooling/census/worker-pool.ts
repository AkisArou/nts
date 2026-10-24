// One in-flight case per kernel-bounded worker, preserving survivor verdicts.
// A dead worker's persistent slice retains its oom_kill count until this run
// closes. A restart starts a fresh scope and takes a new baseline per case.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Admission, createFeed } from "../gate/admission.ts";
import { MemoryRun } from "./worker-memory.ts";

export type ResidentPoolOptions = {
  paths: string[];
  jobs: number;
  memory: MemoryRun;
  workerBytes: number;
  command?: string;
  args: (index: number) => string[];
  onRow: (row: any) => void;
  report?: (message: string) => void;
  admission?: Admission;
};

export async function runMemoryWorkers({ paths, jobs, memory, workerBytes, command = process.execPath, args, onRow, report = () => {}, admission = new Admission({ report }) }: ResidentPoolOptions) {
  const queue = createFeed(paths, admission);
  const tasks: Promise<void>[] = [];
  const worker = async (index: number) => {
    const bound = memory.worker(index, workerBytes);
    let again = true;
    while (again) {
      again = await new Promise<boolean>((resolve, reject) => {
        const scope = bound.scope(command, args(index));
        const child = spawn("systemd-run", scope.argv, { stdio: ["pipe", "pipe", "inherit"], env: scope.env });
        let exited = false;
        let restarting = false;
        let active: string | undefined;
        let before = 0;
        const capped = (path: string) => ({ path, bucket: "memory-cap", why: "worker or child killed in resident scope", residentWorkerBytes: bound.bytes, residentRunBytes: memory.budgetBytes });
        const fail = (error: unknown) => {
          exited = true;
          try { bound.stop(scope); } catch {}
          reject(error);
        };
        const feed = () => queue.feed({
          write: (path) => {
            if (active !== undefined) throw new Error(`worker ${index} already owns ${active}`);
            before = bound.kills();
            active = path;
            child.stdin.write(`${path}\n`);
          },
          end: () => child.stdin.end(),
          exited: () => exited || restarting,
        }).catch(fail);
        child.on("error", fail);
        child.stdin.on("error", (error) => { if (!exited && !restarting) fail(error); });
        createInterface({ input: child.stdout }).on("line", (line) => {
          try {
            const row = JSON.parse(line);
            if (row.path !== active) throw new Error(`worker ${index} answered ${row.path}, expected ${active}`);
            const killed = bound.kills() !== before;
            active = undefined;
            onRow(killed ? capped(row.path) : row);
            // Stop the entire scope before reuse, including any compiler child
            // left by a timed-out command. Only this worker is replaced.
            if (killed || row.bucket === "memory-cap" || row.bucket === "timeout") {
              restarting = true;
              bound.stop(scope);
            } else {
              void feed();
            }
          } catch (error) { fail(error); }
        });
        child.on("exit", () => { exited = true; });
        // 'close' follows all stdout lines, unlike 'exit'. A final valid answer
        // must be consumed before deciding whether the process lost a case.
        child.on("close", (code, signal) => {
          exited = true;
          try {
            bound.stop(scope);
            if (active !== undefined) {
              if (bound.kills() === before) throw new Error(`worker ${index} lost ${active}: ${signal ?? code}; no OOM kill recorded`);
              onRow(capped(active));
              active = undefined;
              restarting = true;
            } else if (code !== 0 && !restarting) {
              throw new Error(`worker ${index} exited ${signal ?? code} without an in-flight OOM case`);
            }
            resolve(restarting && queue.dispatched < paths.length);
          } catch (error) { reject(error); }
        });
        const start = async () => {
          const deadline = Date.now() + 15_000;
          while (!bound.ready(scope)) {
            if (exited) throw new Error(`resident cap: worker ${index} failed before bounded entry`);
            if (Date.now() >= deadline) throw new Error(`resident cap: worker ${index} scope did not become ready`);
            await new Promise((resume) => setTimeout(resume, 10));
          }
          await feed();
        };
        void start().catch(fail);
      });
    }
  };
  try {
    for (let index = 0; index < Math.min(jobs, paths.length); index++) tasks.push(worker(index));
    await Promise.all(tasks);
    const ooms = memory.aggregateOoms();
    if (ooms) report(`resident aggregate cap fired ${ooms} time(s); only workers with an oom_kill delta lost their cases`);
  } catch (error) {
    memory.close();
    await Promise.allSettled(tasks);
    throw error;
  } finally {
    memory.close();
  }
}
