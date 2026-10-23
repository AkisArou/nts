// The tracked catalogue describes refs; this module never creates or deletes one.
import { readFileSync } from "node:fs";
export type ArchiveRow = { ref: string; lane: string; what: string; why: string; resume: string };
export const ARCHIVE_HEADER = "ref\tlane\twhat\twhy parked\twhat resuming needs";
export function parseArchives(text: string): ArchiveRow[] {
  const lines = text.split("\n").filter(l => l && !l.startsWith("#"));
  if (lines.shift() !== ARCHIVE_HEADER) throw new Error("Invalid archive registry header");
  const seen = new Set<string>();
  return lines.map(line => {
    const fields = line.split("\t");
    if (fields.length !== 5 || fields.some(f => !f.trim())) throw new Error("Archive registry rows need five nonempty fields; use unknown explicitly");
    const [ref, lane, what, why, resume] = fields;
    if (!ref.startsWith("refs/archive/") || /\s/.test(ref) || seen.has(ref)) throw new Error(`Invalid or duplicate archive registry ref: ${ref}`);
    seen.add(ref); return { ref, lane, what, why, resume };
  });
}
export function archiveCoverage(refs: string[], registry: ArchiveRow[]) {
  const actual = new Set(refs), listed = new Set(registry.map(r => r.ref));
  return { missing: refs.filter(r => !listed.has(r)).sort(), absent: registry.filter(r => !actual.has(r.ref)).map(r => r.ref).sort() };
}
export function readArchives(file: string): ArchiveRow[] { return parseArchives(readFileSync(file, "utf8")); }
export function requireArchiveCoverage(refs: string[], file: string): ArchiveRow[] {
  const rows = readArchives(file), { missing, absent } = archiveCoverage(refs, rows);
  if (missing.length || absent.length) throw new Error(`Archive registry does not match refs: ${missing.length} missing rows${missing.length ? ` (${missing.join(", ")})` : ""}; ${absent.length} rows without refs${absent.length ? ` (${absent.join(", ")})` : ""}`);
  return rows;
}
