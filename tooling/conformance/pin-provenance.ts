// Reading a pin's provenance does not need the tool that builds pins.
import {existsSync, readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";

export type PinProvenance = {
  sha: string;
  applied: {source: string; sha256: string; files: string[]; insertions?: number; deletions?: number} | null;
  clean?: boolean;
  binary_sha256?: string;
  [key: string]: unknown;
};

/** The provenance recorded beside `binary`, or null when nothing built it here. */
export function provenanceOf(binary: string): PinProvenance | null {
  const file = join(dirname(resolve(binary)), "provenance.json");
  if (!existsSync(file)) return null;
  try {
    const record = JSON.parse(readFileSync(file, "utf8"));
    return record.sha && "applied" in record ? record : null;
  } catch {
    return null;
  }
}
