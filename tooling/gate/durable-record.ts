import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
export function durableRecord(path: string, value: unknown): void {
  const directory = dirname(path); mkdirSync(directory, { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}`;
  let file: number | undefined;
  try {
    file = openSync(temporary, "wx", 0o600); writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(file); closeSync(file); file = undefined;
    renameSync(temporary, path);
    for (const path of [directory, dirname(directory)]) { const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
  } finally { if (file !== undefined) closeSync(file); rmSync(temporary, { force: true }); }
}
