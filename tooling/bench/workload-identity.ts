import assert from "node:assert/strict";
import { createHash } from "node:crypto";

type Obj = Record<string, unknown>;
function object(value: unknown): Obj {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "workload object missing");
  return value as Obj;
}
function values(value: unknown): unknown[] {
  assert.ok(Array.isArray(value), "workload array missing");
  return value;
}
function string(value: unknown): string {
  assert.equal(typeof value, "string");
  return value as string;
}
function fields(value: Obj, required: string[], optional: string[] = []): void {
  assert.ok(required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key)),
    "unknown or missing semantic workload field; decide its identity encoding");
}
/**
 * Semantic identity v1. Keep the pre-answer encoding for synchronous calls.
 * Producer JSON order and the presence of defaults have no semantic meaning.
 * A schema extension refuses until its default and nondefault meanings are
 * deliberately encoded here; it cannot silently erase comparison history.
 */
export function semanticWorkload(input: unknown): unknown {
  const workload = object(input);
  fields(workload, ["numeric", "roots"]);
  const roots = values(workload.roots).map(string);
  assert.ok(roots.length > 0 && new Set(roots).size === roots.length, "empty or duplicate workload roots");
  let numeric: unknown = null;
  if (workload.numeric !== null) {
    const n = object(workload.numeric);
    fields(n, ["callee", "seed"], ["answer"]);
    assert.ok(typeof n.seed === "number" && Number.isFinite(n.seed), "workload seed must be finite");
    assert.ok(n.answer === undefined || n.answer === "Returned" || n.answer === "Promised", "unknown workload answer");
    const callee = string(n.callee);
    assert.ok(callee.length > 0, "empty workload callee");
    // The legacy Workload struct serialized roots before numeric. Preserve its bytes,
    // including IEEE-754 signed zero, to retain all established identities.
    numeric = n.answer === "Promised" ? { callee, seed: n.seed, answer: "Promised" } : { callee, seed: n.seed };
  }
  return { roots, numeric };
}

/** JSON-safe retained declaration, including signed zero and every input bit. */
export function encodeWorkload(input: unknown): string {
  return JSON.stringify(input, (_, value) => {
    if (typeof value !== "number") return value;
    const bits = Buffer.alloc(8); bits.writeDoubleBE(value);
    return { float64Bits: bits.toString("hex") };
  });
}
export function decodeWorkload(input: string): unknown {
  return JSON.parse(input, (_, value) => {
    if (value && typeof value === "object" && Object.keys(value).length === 1 && typeof value.float64Bits === "string") {
      assert.match(value.float64Bits, /^[a-f0-9]{16}$/);
      return Buffer.from(value.float64Bits, "hex").readDoubleBE();
    }
    return value;
  });
}

/** Identity supplied by the exact compiler capture; never resolve or reread a source here. */
export function workloadIdentity(capture: unknown, input: unknown): string | null {
  if (capture === null || capture === undefined) return null;
  const c = object(capture);
  assert.equal(c.algorithm, "xxh3-128-le-checked-utf8-v1");
  const files = values(c.workload)
    .map((raw) => {
      const f = object(raw),
        path = string(f.path),
        digest = string(f.digest);
      assert.match(digest, /^[a-f0-9]{32}$/);
      return { path, digest, rewrittenBy: f.rewritten_by ?? null };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  assert.ok(
    files.length > 0 && new Set(files.map((f) => f.path)).size === files.length,
    "empty or duplicate captured workload",
  );
  const exact = encodeWorkload(semanticWorkload(input));
  return createHash("sha256")
    .update(
      JSON.stringify({ algorithm: c.algorithm, files, input: exact, drivers: c.drivers ?? [] }),
    )
    .digest("hex");
}
