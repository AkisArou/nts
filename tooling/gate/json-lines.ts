// Reads an append-only JSON-lines file while its writer may still be appending.
// A writer appends each row as one line, but a concurrent read of a regular
// file is not atomic with that write: it can return the start of a line before
// its newline. The reader therefore owns completeness. It parses only through
// the last newline and keeps the rest for the next read. A complete line that
// does not parse is a real defect and throws, naming the file.
import { closeSync, fstatSync, openSync, readSync, watch } from "node:fs";

const NEWLINE = 0x0a;

export class JsonLinesTail {
  readonly path: string;
  private offset = 0;
  private pending: Buffer = Buffer.alloc(0);

  constructor(path: string) { this.path = path; }

  /** The rows completed since the previous read, in file order. */
  read(): unknown[] {
    const fd = openSync(this.path, "r");
    let added: Buffer;
    try {
      const size = fstatSync(fd).size;
      if (size < this.offset) throw new Error(`${this.path}: shrank from ${this.offset} to ${size} bytes; a JSON-lines tail reads only an append-only file`);
      added = Buffer.alloc(size - this.offset);
      let filled = 0;
      while (filled < added.length) {
        const n = readSync(fd, added, filled, added.length - filled, this.offset + filled);
        if (n === 0) break;
        filled += n;
      }
      added = added.subarray(0, filled);
      this.offset += filled;
    } finally { closeSync(fd); }
    // A newline byte never occurs inside a multi-byte UTF-8 sequence, so
    // splitting the bytes at the last newline never splits a character.
    const bytes = this.pending.length ? Buffer.concat([this.pending, added]) : added;
    const end = bytes.lastIndexOf(NEWLINE);
    if (end < 0) { this.pending = Buffer.from(bytes); return []; }
    this.pending = Buffer.from(bytes.subarray(end + 1));
    const rows: unknown[] = [];
    for (const line of bytes.subarray(0, end).toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); }
      catch (error) { throw new Error(`${this.path}: a complete line is not JSON: ${line}`, { cause: error }); }
    }
    return rows;
  }
}

/**
 * Resolves with the first complete row `match` accepts, reading the file on
 * each change notification. The file must exist. It checks once after the
 * watcher is attached, so a row written before the watch is still seen. A read
 * failure rejects the promise; it never throws from inside the watcher.
 */
export function waitForJsonLine<T = unknown>(path: string, match: (row: T) => boolean): Promise<T> {
  const tail = new JsonLinesTail(path);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const watcher = watch(path, () => check());
    const finish = (settle: () => void) => { if (settled) return; settled = true; watcher.close(); settle(); };
    watcher.on("error", error => finish(() => reject(error)));
    function check() {
      if (settled) return;
      try {
        const rows = tail.read() as T[], at = rows.findIndex(row => match(row));
        if (at >= 0) finish(() => resolve(rows[at]!));
      } catch (error) { finish(() => reject(error)); }
    }
    check();
  });
}
