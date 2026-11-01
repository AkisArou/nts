// A versioned producer record, bound to the actual addon glue. No C grammar.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ExportRow = {
  path: string[];
  kind: "function" | "class" | "value" | "namespace";
  name: string;
  arity: number | null;
  required: number | null;
  symbol: string;
};

function fail(reason: string): never {
  throw new Error(`Node-API export manifest: ${reason}`);
}

const hash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const count = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffffffff;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function validateManifest(text: string, source: Buffer): ExportRow[] {
  let document: unknown;
  try { document = JSON.parse(text); } catch { fail("malformed JSON"); }
  if (!object(document)) fail("expected an object");
  if (document.version !== 1) fail(`unsupported version ${String(document.version)}`);
  if (!Array.isArray(document.exports) || !count(document.export_count)) fail("invalid export inventory");
  if (document.exports.length !== document.export_count) fail("export count does not match the complete inventory");
  const rows: ExportRow[] = document.exports.map((value: unknown, index: number) => {
    if (!object(value) || !Array.isArray(value.path) || value.path.length === 0 ||
        !value.path.every((key: unknown) => typeof key === "string") ||
        !["function", "class", "value", "namespace"].includes(String(value.kind)) ||
        typeof value.name !== "string" || typeof value.symbol !== "string" || value.symbol.length === 0) {
      fail(`invalid export row ${index}`);
    }
    const callable = value.kind === "function" || value.kind === "class";
    if (callable ? !count(value.arity) || !count(value.required) : value.arity !== null || value.required !== null) {
      fail(`invalid arity in export row ${index}`);
    }
    // This field order is the version-1 canonical row encoding used by Rust.
    return { path: value.path as string[], kind: value.kind as ExportRow["kind"],
      name: value.name, arity: value.arity as number | null,
      required: value.required as number | null, symbol: value.symbol };
  });
  if (hash(source) !== document.source_sha256) fail("glue hash does not match addon.c");
  if (hash(JSON.stringify(rows)) !== document.exports_sha256) fail("export inventory hash does not match");
  return rows;
}

export function readManifest(directory: string): ExportRow[] {
  let text: string;
  let source: Buffer;
  try { text = readFileSync(join(directory, "addon.exports.json"), "utf8"); }
  catch { fail(`missing or unreadable addon.exports.json in ${directory}`); }
  try { source = readFileSync(join(directory, "addon.c")); }
  catch { fail(`missing or unreadable addon.c in ${directory}`); }
  return validateManifest(text, source);
}

export function readArityRows(directory: string) {
  return readManifest(directory).filter((row) => row.kind === "function" || row.kind === "class")
    .map((row) => ({ name: row.name, symbol: row.symbol, length: row.arity!, demands: row.required!, isClass: row.kind === "class" }));
}

export function hasPublishedExport(directory: string, key: string): boolean {
  return readManifest(directory).some((row) => row.path.length === 1 && row.path[0] === key);
}
