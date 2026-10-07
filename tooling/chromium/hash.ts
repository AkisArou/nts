/**
 * SHA-256 of a file, read in pieces: a static debug Chromium executable is
 * over 2 GiB, which node will not read into one buffer.
 */
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";

export function sha256File(path: string): string {
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(8 << 20);
  const file = openSync(path, "r");
  try {
    for (let read; (read = readSync(file, buffer, 0, buffer.length, null)) > 0;) digest.update(buffer.subarray(0, read));
  } finally {
    closeSync(file);
  }
  return digest.digest("hex");
}
