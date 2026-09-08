// Every binding's declared type against the type its C actually has.
//
//   node tooling/conformance/binding-abi-audit.mjs
//   node tooling/conformance/binding-abi-audit.mjs --verbose
//
// A binding is a triple -- a `declare function` in TypeScript, an
// implementation in C, and a stand-in in `bindings.node.mjs` -- and the first
// two have to agree about types or the emitted C does not compile. Nothing was
// checking that. Two instances were found by hand, both in `zlib`, both the same
// shape: a parameter declared `Uint8Array` implemented as `NtsArray *`, when a
// `Uint8Array` lowers to `NtsView *`. `nts_crc32` was the first and seven more
// signatures in the same file were the second.
//
// **Neither lane can see this class of defect.** The interpreted lane's
// stand-ins are node's own implementations, so it agrees with node whatever the
// C says. The compiled lane would object, but only for a module that gets far
// enough to emit C -- and fifteen of twenty-two do not. So a mismatch sits
// silently until the day its module starts compiling, which is exactly when the
// most other things are also changing.
//
// This reads the declarations and the C prototypes and compares them directly,
// which finds the whole class in one pass instead of one probe at a time.

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const VERBOSE = process.argv.includes("--verbose");

/** What a TypeScript type lowers to at a native boundary. */
function expectedC(tsType) {
  const t = tsType.replace(/\s+/g, " ").trim();
  if (/^(Uint8Array|Int8Array|Uint8ClampedArray|Int16Array|Uint16Array|Int32Array|Uint32Array|Float32Array|Float64Array|BigInt64Array|BigUint64Array|DataView)$/.test(t)) {
    return "NtsView *";
  }
  if (t === "number") return "double";
  if (t === "boolean") return "bool";
  if (t === "string") return "NtsString *";
  if (t === "void") return "void";
  if (t === "bigint") return "__int128";
  if (/^Promise</.test(t)) return "NtsPromise *";
  if (/\[\]$/.test(t)) return "NtsArray *";
  // A tuple: homogeneous lowers to NtsArray, heterogeneous to a struct. Both
  // are reported as tuple so the caller can say which, since the heterogeneous
  // case is a separate open blocker.
  if (/^\[/.test(t)) return "tuple";
  return null; // unions, interfaces, aliases -- not decided here
}

/** `declare function nts_x(a: T, b: U): R;` across every module, multi-line. */
function declarations() {
  const out = new Map();
  for (const file of globSync(join(ROOT, "runtime/node/**/*.ts"), { exclude: (p) => p.includes("node_modules") })) {
    const text = readFileSync(file, "utf8");
    const re = /declare function (nts_[A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*:\s*([^;]+);/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const [, name, params, ret] = m;
      // Split top-level commas only; a tuple parameter contains its own.
      const parts = [];
      let depth = 0, current = "";
      for (const ch of params) {
        if ("[<({".includes(ch)) depth++;
        if ("]>)}".includes(ch)) depth--;
        if (ch === "," && depth === 0) { parts.push(current); current = ""; continue; }
        current += ch;
      }
      if (current.trim() !== "") parts.push(current);
      const types = parts
        .map((p) => p.split(":").slice(1).join(":").trim())
        .filter((p) => p !== "");
      if (!out.has(name)) out.set(name, { file: relative(ROOT, file), params: types, ret: ret.trim() });
    }
  }
  return out;
}

/** `Ret *nts_x(T a, U b);` from the headers, multi-line. */
function prototypes() {
  const out = new Map();
  const files = [
    ...globSync(join(ROOT, "runtime/node/**/*.h"), { exclude: (p) => p.includes("node_modules") }),
    join(ROOT, "runtime/c/nts_runtime.h"),
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const re = /^([A-Za-z_][A-Za-z0-9_]*(?:\s+\*|\s*\*|\s))\s*(nts_[A-Za-z0-9_]+)\s*\(([\s\S]*?)\)\s*;/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
      const [, ret, name, params] = m;
      if (out.has(name)) continue;
      const types = params.split(",").map((p) => {
        const q = p.trim().replace(/\bconst\b/g, "").trim();
        if (q === "void" || q === "") return null;
        // Drop the parameter name: everything up to the last identifier.
        return q.replace(/\s*[A-Za-z_][A-Za-z0-9_]*\s*$/, "").trim().replace(/\s+/g, " ") ||
          q.replace(/\s+/g, " ");
      }).filter((p) => p !== null);
      out.set(name, { file: relative(ROOT, file), ret: ret.trim().replace(/\s+/g, " "), params: types });
    }
  }
  return out;
}

function normalizeC(t) {
  return t.replace(/\s*\*/, " *").replace(/\s+/g, " ").trim();
}

const decls = declarations();
const protos = prototypes();
let mismatches = 0, checked = 0, skipped = 0, noProto = 0;

for (const [name, d] of [...decls].sort()) {
  const p = protos.get(name);
  if (p === undefined) { noProto++; continue; }
  const problems = [];
  const wantRet = expectedC(d.ret);
  if (wantRet === "tuple") {
    // Homogeneous tuples lower to NtsArray; heterogeneous to a struct, which no
    // binding can currently return -- see blockers/heterogeneous-tuple-return.
    const inner = d.ret.replace(/^\[|\]$/g, "").split(",").map((x) => x.trim()).filter(Boolean);
    const homogeneous = new Set(inner.map((x) => expectedC(x) ?? x)).size === 1;
    if (homogeneous && normalizeC(p.ret) !== "NtsArray *") {
      problems.push(`returns ${d.ret} (homogeneous tuple -> NtsArray *) but C says ${p.ret}`);
    }
  } else if (wantRet !== null && normalizeC(p.ret) !== wantRet) {
    problems.push(`returns ${d.ret} -> ${wantRet}, C says ${p.ret}`);
  }
  for (let i = 0; i < d.params.length; i++) {
    const want = expectedC(d.params[i]);
    const got = p.params[i];
    if (want === null || want === "tuple" || got === undefined) continue;
    if (normalizeC(got) !== want) {
      problems.push(`param ${i} is ${d.params[i]} -> ${want}, C says ${got}`);
    }
  }
  checked++;
  if (problems.length === 0) {
    if (VERBOSE) console.log(`  ok    ${name}`);
    continue;
  }
  mismatches++;
  console.log(`  MISMATCH  ${name}   ${d.file}  vs  ${p.file}`);
  for (const problem of problems) console.log(`            ${problem}`);
}

console.log(
  `\n  ${checked} binding(s) with a prototype checked, ${mismatches} disagreeing; ` +
    `${noProto} declared with no prototype found`,
);
process.exitCode = mismatches > 0 ? 1 : 0;
