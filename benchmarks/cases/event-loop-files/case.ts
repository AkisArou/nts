// File I/O through `node:fs/promises`: write, read back and remove sixteen
// small files at once.
//
// One call is a fixed amount of it: sixteen round trips started together and
// awaited through `Promise.all`, each a `writeFile` of 1 KiB, a `readFile` of
// it as UTF-8 and an `unlink` -- 48 operations on libuv's thread pool and
// their completions on the loop. The files live in the process's temporary
// directory under names carrying its pid, so two columns never share one, and
// no path enters the checksum: the bytes read back and their last character
// do, so a short or wrong read is a wrong answer.
//
// The call answers with a promise, so every column waits for the last
// completion before the call counts as done (tooling/bench's promised
// workload).
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FILES = 16;
const contents: string[] = [];
for (let i = 0; i < FILES; i++) {
  contents.push(String.fromCharCode(97 + i).repeat(1024));
}

async function roundTrip(file: number, text: string): Promise<number> {
  const path = join(tmpdir(), `nts-bench-event-loop-files-${process.pid}-${file}`);
  await writeFile(path, text);
  const read = await readFile(path, "utf8");
  await unlink(path);
  return read.length + read.charCodeAt(read.length - 1);
}

export async function work(n: number): Promise<number> {
  const trips: Promise<number>[] = [];
  for (let i = 0; i < FILES; i++) {
    trips.push(roundTrip(i, contents[i]!));
  }
  let sum = n;
  for (const trip of await Promise.all(trips)) {
    sum += trip;
  }
  return sum;
}

export const seed = 1;
