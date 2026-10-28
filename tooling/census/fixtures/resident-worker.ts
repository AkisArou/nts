import { waitFor, testProcessResult, TEST_HANG_MS } from "../../gate/test-wait.ts";
// Fake compiler input for the real resident worker pool's kernel controls.
import { createInterface } from "node:readline";
import { closeSync, constants, existsSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileSync, inResidentWorker } from "../worker-memory.ts";
if (!inResidentWorker()) throw new Error("fixture outside resident scope");
const directory = process.argv[2];
const deadlineWait = (path: string) => waitFor(`resident fixture barrier ${path}`,()=>existsSync(path));
for await (const path of createInterface({ input: process.stdin })) {
  let held: Buffer | undefined;
  if (path === "oom") {
    const result = testProcessResult(compileSync({ memoryCapKb: 96 * 1024 }, "python3", ["-c", "chunks=[]\nwhile True: chunks.append(bytearray(8*1024*1024))"], { encoding: "utf8", timeout: TEST_HANG_MS }), "the fixture allocation to reach its resident cap");
    // The parent must override this non-memory result from the kernel counter.
    process.stdout.write(`${JSON.stringify({ path, bucket: "compiler-result", status: result.status })}\n`);
    continue;
  }
  if (path === "pressure-a" || path === "pressure-b") {
    const isolated = Number(process.argv[3]) >= 2;
    let release: number | undefined;
    const released = Buffer.alloc(1);
    if (!isolated) {
      release = openSync(join(directory, `release-${path}`), constants.O_RDWR);
      writeFileSync(join(directory, `ready-${path}`), "ready");
      await deadlineWait(join(directory, "ready-pressure-a"));
      await deadlineWait(join(directory, "ready-pressure-b"));
    }
    // Identical work in both phases. Only the parallel handshake is absent
    // during isolated replay, when there is deliberately no peer to await.
    held = Buffer.alloc(400 * 2 ** 20, 1);
    if (release !== undefined) {
      try {
        if (readSync(release, released, 0, 1, null) !== 1) throw new Error("pressure fixture was not released");
      } finally { closeSync(release); }
    }
  }
  if (path === "lost") process.exit(17);
  process.stdout.write(`${JSON.stringify({ path, bucket: "strict-pass", pid: process.pid, held: held?.length ?? 0 })}\n`);
}
